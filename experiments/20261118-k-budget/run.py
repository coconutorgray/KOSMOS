"""20261118-k-budget — 실행: python experiments/20261118-k-budget/run.py  (KOSMOS 루트에서, 약 10분)
k를 줄였을 때 전체 데이터의 보정 후 validation TVD·모델 순서가 재현되는 최소 k(H1)와
작은 k의 TVD 곡선으로 전체 k 값을 외삽할 수 있는지(H2)를 잰다."""
import itertools
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "research/design_v2_20261112/dataset"))
import silicon as sl  # noqa: E402

KS = [5, 10, 15, 20, 30, 40, 50, 70]
REPS = 10
BETAS = np.round(np.arange(0.05, 1.5001, 0.01), 3)
TOL_TVD = 0.01        # H1-A: 반복별 TVD_k − TVD_full 허용치
PASS_REPS = 9         # 10회 중 9회 이상
TIE = 0.005           # H1-B: 전체 데이터에서 이보다 가까운 모델 쌍은 동률로 보고 순서 판정에서 뺀다
FIT_KS = [5, 10, 15, 20, 30]   # H2: 외삽에 쓰는 작은 k
TOL_PRED = 0.005      # H2 허용 오차

df = sl.load()                                   # test 제외
df = df.sort_values(sl.KEY + ["opt_idx"], kind="stable").reset_index(drop=True)
grp = df.groupby(sl.KEY, sort=False).indices
counts = df["count"].to_numpy()


def subsample(k, rng):
    new = counts.copy()
    for idx in grp.values():
        c = counts[idx]
        if int(c.sum()) > k:
            new[idx] = rng.multivariate_hypergeometric(c, k)
    return df.assign(count=new)


def val_tvd(d):
    beta = sl.fit_beta(d, betas=BETAS)
    return sl.summary(d[d["split"] == "validation"], beta), beta


# ── 기준값: 전체 데이터 ─────────────────────────────────
full, beta_full = val_tvd(df)
models = list(full.index)
k_full = df.groupby(sl.KEY)["n_valid"].first().groupby(level="model").median()
print("[전체 데이터 validation TVD]\n", full.round(4), "\n전체 k(중앙값):", k_full.to_dict(), flush=True)

# ── 부분추출 반복 ──────────────────────────────────────
rows = []
for ki, k in enumerate(KS):
    for rep in range(REPS):
        s, beta = val_tvd(subsample(k, np.random.default_rng(1000 * ki + rep)))
        for m in models:
            for lv in sl.LEVELS:
                rows.append(dict(k=k, rep=rep, model=m, level=lv, tvd=s.loc[m, lv], beta=beta[(m, lv)],
                                 tvd_full=full.loc[m, lv]))
    print("k =", k, "완료", flush=True)
r = pd.DataFrame(rows)
r["gap"] = r["tvd"] - r["tvd_full"]

# ── H1-A: TVD 재현 ────────────────────────────────────
a = r.assign(ok=r["gap"] <= TOL_TVD).groupby(["model", "level", "k"]).agg(
    tvd_mean=("tvd", "mean"), tvd_sd=("tvd", "std"), gap_mean=("gap", "mean"), gap_max=("gap", "max"),
    n_ok=("ok", "sum"), beta_mean=("beta", "mean")).reset_index()
a["pass_A"] = a["n_ok"] >= PASS_REPS

# ── H1-B: 모델 순서 재현 ──────────────────────────────
pairs = []
for lv in sl.LEVELS:
    for m1, m2 in itertools.combinations(models, 2):
        gap = full.loc[m1, lv] - full.loc[m2, lv]
        pairs.append(dict(level=lv, m1=m1, m2=m2, full_gap=gap, judged=abs(gap) >= TIE))
pairs = pd.DataFrame(pairs)
wide = r.pivot_table(index=["k", "rep", "level"], columns="model", values="tvd").reset_index()
b_rows = []
for p in pairs.itertuples():
    w = wide[wide["level"] == p.level]
    same = np.sign(w[p.m1] - w[p.m2]) == np.sign(p.full_gap)
    for k, n in same.groupby(w["k"]).sum().items():
        b_rows.append(dict(level=p.level, pair=f"{p.m1}-{p.m2}", full_gap=p.full_gap, judged=p.judged,
                           k=k, n_same=int(n), pass_B=(not p.judged) or n >= PASS_REPS))
b = pd.DataFrame(b_rows)

# ── k* ────────────────────────────────────────────────
by_k = pd.DataFrame({"all_A": a.groupby("k")["pass_A"].all(), "all_B": b.groupby("k")["pass_B"].all()})
by_k["pass"] = by_k["all_A"] & by_k["all_B"]
k_star = int(by_k.index[by_k["pass"]].min()) if by_k["pass"].any() else None
k_star_cell = a[a["pass_A"]].groupby(["model", "level"])["k"].min().reindex(
    pd.MultiIndex.from_product([models, sl.LEVELS], names=["model", "level"]))
print("\n[k별 판정]\n", by_k, "\nk* =", k_star)
print("\n[칸별 A 통과 최소 k]\n", k_star_cell.unstack("level"))

# ── H2: c + a/√k 외삽 ─────────────────────────────────
h2 = []
for (m, lv), g in a[a["k"].isin(FIT_KS)].groupby(["model", "level"]):
    X = np.column_stack([np.ones(len(g)), 1 / np.sqrt(g["k"])])
    (c, slope), *_ = np.linalg.lstsq(X, g["tvd_mean"].to_numpy(), rcond=None)
    pred = c + slope / np.sqrt(k_full[m])
    naive = g.loc[g["k"] == max(FIT_KS), "tvd_mean"].iloc[0]
    h2.append(dict(model=m, level=lv, c=c, a=slope, k_full=k_full[m], pred=pred, tvd_full=full.loc[m, lv],
                   err_pred=pred - full.loc[m, lv], err_naive_k30=naive - full.loc[m, lv]))
h2 = pd.DataFrame(h2)
h2["pass"] = h2["err_pred"].abs() <= TOL_PRED
print("\n[H2 외삽]\n", h2.round(4))

# ── 그림 ──────────────────────────────────────────────
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
plt.rcParams["font.family"] = ["Malgun Gothic", "AppleGothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False
names = {"exaone": "K-EXAONE 2.5", "deepseek": "DeepSeek V4.1 Flash", "haiku": "Claude Haiku 5.5"}
colors = {"exaone": "#d95f02", "deepseek": "#1b9e77", "haiku": "#7570b3"}
fig, axes = plt.subplots(1, 3, figsize=(13, 4), sharey=True)
kk = np.linspace(5, 100, 200)
for ax, lv in zip(axes, sl.LEVELS):
    for m in models:
        c = a[(a.model == m) & (a.level == lv)]
        ax.errorbar(c.k, c.tvd_mean, yerr=c.tvd_sd, fmt="o", ms=4, color=colors[m], label=names.get(m, m))
        h = h2[(h2.model == m) & (h2.level == lv)].iloc[0]
        ax.plot(kk, h.c + h.a / np.sqrt(kk), "--", lw=1, color=colors[m])
        ax.plot([h.k_full], [h.tvd_full], "*", ms=12, color=colors[m])
    if k_star:
        ax.axvline(k_star, color="gray", ls=":", lw=1)
    ax.set_title({"c0": "c0 (페르소나 없음)", "L0": "L0 (한국 성인)", "L1": "L1 (성별×연령)"}[lv])
    ax.set_xlabel("프롬프트당 표본 수 k")
    ax.grid(alpha=0.3)
axes[0].set_ylabel("보정 후 validation TVD")
axes[0].legend(fontsize=8)
fig.suptitle("점: 부분추출 평균±sd, 점선: k≤30으로 맞춘 c+a/√k, 별: 전체 데이터")
fig.tight_layout()
(HERE / "out").mkdir(exist_ok=True)
fig.savefig(HERE / "out/k_budget.png", dpi=130)

tables = {"reps": r.set_index(["model", "level", "k", "rep"]),
          "h1_tvd_by_k": a.set_index(["model", "level", "k"]),
          "h1_order_by_k": b.set_index(["level", "pair", "k"]),
          "h1_verdict_by_k": by_k,
          "h2_extrapolation": h2.set_index(["model", "level"]),
          "full_data_tvd": full}
run = sl.save_run(HERE / "out", tables=tables, params={
    "ks": KS, "reps": REPS, "tol_tvd": TOL_TVD, "pass_reps": PASS_REPS, "tie": TIE, "fit_ks": FIT_KS,
    "tol_pred": TOL_PRED, "beta_full": beta_full, "k_full": k_full.to_dict(), "k_star": k_star, "alpha": sl.ALPHA})
print(f"\n기록: {HERE / 'out/run.json'} (commit {run['git_commit']}, dirty={run['git_dirty']})")
