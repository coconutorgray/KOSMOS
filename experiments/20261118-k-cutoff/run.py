"""20261118-k-cutoff — 실행: PYTHONUTF8=1 python experiments/20261118-k-cutoff/run.py  (KOSMOS 루트에서, 약 15~25분)
k를 2 간격(10~90)·반복 50회로 줄여 보며 전체 데이터의 보정 후 validation TVD·모델 순서를 90% 확률로
재현하는 cut-off k와 비용–오차 곡선의 knee를 잰다."""
import itertools
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "research/design_v2_20261112/dataset"))
import silicon as sl  # noqa: E402

KS = list(range(10, 91, 2))
REPS = 50
BETAS = np.round(np.arange(0.05, 1.5001, 0.01), 3)
TOL, TOL_STRICT = 0.01, 0.005
P_TARGET = 0.9
TIE = 0.005
N_BOOT = 500

# ── 데이터와 빠른 채점기 ────────────────────────────────
df = sl.load()                                   # test 제외
df = df.sort_values(sl.KEY + ["opt_idx"], kind="stable").reset_index(drop=True)
gid = df.groupby(sl.KEY, sort=False).ngroup().to_numpy()
starts = np.flatnonzero(np.r_[True, gid[1:] != gid[:-1]])
assert len(starts) == gid.max() + 1, "그룹이 연속이 아님"
sizes = np.diff(np.r_[starts, len(df)])
G = df.iloc[starts][["model", "level", "var", "split"]].reset_index(drop=True)
counts0 = df["count"].to_numpy().astype(float)
human = df["human_p"].to_numpy()


def make_split(split):
    sel = G.index[G["split"] == split].to_numpy()
    g = G.loc[sel]
    order = np.lexsort((g["var"].to_numpy(), g["level"].to_numpy(), g["model"].to_numpy()))
    sel, g = sel[order], g.iloc[order].reset_index(drop=True)
    mlv = g["model"] + "|" + g["level"] + "|" + g["var"]
    mlv_st = np.flatnonzero(np.r_[True, mlv.to_numpy()[1:] != mlv.to_numpy()[:-1]])
    mlv_n = np.diff(np.r_[mlv_st, len(g)])
    ml_of_mlv = (g["model"] + "|" + g["level"]).to_numpy()[mlv_st]
    ml_st = np.flatnonzero(np.r_[True, ml_of_mlv[1:] != ml_of_mlv[:-1]])
    ml_n = np.diff(np.r_[ml_st, len(ml_of_mlv)])
    labels = [tuple(s.split("|")) for s in ml_of_mlv[ml_st]]
    return dict(sel=sel, mlv_st=mlv_st, mlv_n=mlv_n, ml_st=ml_st, ml_n=ml_n, labels=labels)


SPL = {s: make_split(s) for s in ("calibration", "validation")}
LABELS = SPL["calibration"]["labels"]
assert LABELS == SPL["validation"]["labels"]


def level_tvd(counts, sp):
    """(β 개수, 모델×단계) 배열: silicon.level_mean(score(calibrate(...)))과 같은 값."""
    X = (counts + sl.ALPHA)[None, :] ** BETAS[:, None]
    S = np.add.reduceat(X, starts, axis=1)
    P = X / np.repeat(S, sizes, axis=1)
    T = 0.5 * np.add.reduceat(np.abs(P - human[None, :]), starts, axis=1)[:, sp["sel"]]
    per_item = np.add.reduceat(T, sp["mlv_st"], axis=1) / sp["mlv_n"]
    return np.add.reduceat(per_item, sp["ml_st"], axis=1) / sp["ml_n"]


def val_tvd(counts):
    cal = level_tvd(counts, SPL["calibration"])
    bi = cal.argmin(axis=0)
    val = level_tvd(counts, SPL["validation"])[bi, np.arange(len(LABELS))]
    return dict(zip(LABELS, val)), dict(zip(LABELS, BETAS[bi]))


# ── 기준값 + silicon과 같은지 확인 ─────────────────────
full, beta_full = val_tvd(counts0)
ref_beta = sl.fit_beta(df, betas=BETAS)
ref = sl.summary(df[df["split"] == "validation"], ref_beta)
for (m, lv), v in full.items():
    assert abs(beta_full[(m, lv)] - ref_beta[(m, lv)]) < 1e-9, ("β 불일치", m, lv)
    assert abs(v - ref.loc[m, lv]) < 1e-9, ("TVD 불일치", m, lv)
print("silicon과 일치 확인", flush=True)
models = sorted({m for m, _ in LABELS})
full_tab = pd.Series(full).unstack()[sl.LEVELS]
print(full_tab.round(4), flush=True)

# ── 부분추출 ─────────────────────────────────────────
grp_idx = [np.arange(s, s + n) for s, n in zip(starts, sizes)]
counts_int = df["count"].to_numpy()


def subsample(k, rng):
    new = counts_int.copy()
    for idx in grp_idx:
        c = counts_int[idx]
        if int(c.sum()) > k:
            new[idx] = rng.multivariate_hypergeometric(c, k)
    return new.astype(float)


rows = []
for ki, k in enumerate(KS):
    for rep in range(REPS):
        v, b = val_tvd(subsample(k, np.random.default_rng(100_000 + 1000 * ki + rep)))
        for (m, lv), t in v.items():
            rows.append(dict(k=k, rep=rep, model=m, level=lv, tvd=t, beta=b[(m, lv)], tvd_full=full[(m, lv)]))
    print("k =", k, "완료", flush=True)
r = pd.DataFrame(rows)
r["gap"] = r["tvd"] - r["tvd_full"]
r["ok"] = r["gap"] <= TOL
r["ok_strict"] = r["gap"] <= TOL_STRICT

curve = r.groupby(["model", "level", "k"]).agg(
    p_ok=("ok", "mean"), p_ok_strict=("ok_strict", "mean"), gap_mean=("gap", "mean"),
    gap_q90=("gap", lambda x: x.quantile(0.9)), tvd_mean=("tvd", "mean"), tvd_sd=("tvd", "std"),
    beta_mean=("beta", "mean")).reset_index()


def grid_cutoff(ks, p):
    """p ≥ 0.9가 그 k부터 끝까지 유지되는 가장 작은 k."""
    ks, p = np.asarray(ks), np.asarray(p)
    for i in range(len(ks)):
        if (p[i:] >= P_TARGET).all():
            return int(ks[i])
    return None


def logistic_k90(k, y):
    """통과 ~ log k 로지스틱(IRLS). P=0.9가 되는 k. 분리되면 None."""
    x = np.log(np.asarray(k, float))
    X = np.column_stack([np.ones_like(x), x])
    y = np.asarray(y, float)
    if y.all() or not y.any():
        return None
    w = np.zeros(2)
    for _ in range(100):
        p = 1 / (1 + np.exp(-(X @ w)))
        W = np.clip(p * (1 - p), 1e-9, None)
        step = np.linalg.solve(X.T @ (X * W[:, None]) + 1e-8 * np.eye(2), X.T @ (y - p))
        w += step
        if np.abs(step).max() < 1e-10:
            break
    if w[1] <= 0:
        return None
    return float(np.exp((np.log(P_TARGET / (1 - P_TARGET)) - w[0]) / w[1]))


rng_boot = np.random.default_rng(7)
cut_rows = []
for (m, lv), c in curve.groupby(["model", "level"]):
    sub = r[(r.model == m) & (r.level == lv)]
    k90 = logistic_k90(sub.k, sub.ok)
    boots = []
    for _ in range(N_BOOT):
        reps = rng_boot.integers(0, REPS, REPS)
        bs = pd.concat([sub[sub.rep == q] for q in reps])
        boots.append(logistic_k90(bs.k, bs.ok))
    boots = np.array([b for b in boots if b is not None])
    cut_rows.append(dict(model=m, level=lv, cutoff_grid=grid_cutoff(c.k, c.p_ok),
                         cutoff_grid_strict=grid_cutoff(c.k, c.p_ok_strict), k90_logistic=k90,
                         k90_lo=np.quantile(boots, 0.025) if len(boots) else None,
                         k90_hi=np.quantile(boots, 0.975) if len(boots) else None, n_boot_ok=len(boots)))
cut = pd.DataFrame(cut_rows)
def overall_max(col):
    """한 칸이라도 격자 안에서 cut-off가 없으면 전체도 없음(None)."""
    return None if cut[col].isna().any() else int(cut[col].max())


overall = {"cutoff_grid": overall_max("cutoff_grid"), "cutoff_grid_strict": overall_max("cutoff_grid_strict"),
           "worst_cell_grid": "|".join(cut.loc[cut["cutoff_grid"].fillna(999).idxmax(), ["model", "level"]])}
print("\n[칸별 cut-off]\n", cut.round(1), "\n전체:", overall, flush=True)

# ── 순서 cut-off ─────────────────────────────────────
wide = r.pivot_table(index=["k", "rep", "level"], columns="model", values="tvd").reset_index()
order_rows, pair_rows = [], []
for lv in sl.LEVELS:
    w = wide[wide.level == lv]
    same_all = pd.Series(True, index=w.index)
    for m1, m2 in itertools.combinations(models, 2):
        gap = full[(m1, lv)] - full[(m2, lv)]
        judged = abs(gap) >= TIE
        same = np.sign(w[m1] - w[m2]) == np.sign(gap)
        pair_rows.append(dict(level=lv, pair=f"{m1}-{m2}", full_gap=gap, judged=judged))
        if judged:
            same_all &= same
    p = same_all.groupby(w["k"]).mean()
    for k, v in p.items():
        order_rows.append(dict(level=lv, k=k, p_order=v))
order = pd.DataFrame(order_rows)
order_cut = {lv: grid_cutoff(g.k, g.p_order) for lv, g in order.groupby("level")}
order_cut_all = max(v for v in order_cut.values() if v is not None) if all(order_cut.values()) else None
print("\n[순서 cut-off]", order_cut, "→", order_cut_all, flush=True)

# ── knee (Kneedle) ──────────────────────────────────
worst = curve.groupby("k")["gap_mean"].max()
x = (worst.index - worst.index.min()) / (worst.index.max() - worst.index.min())
y = (worst - worst.min()) / (worst.max() - worst.min())
dist = (1 - x) - y.to_numpy()
knee_k = int(worst.index[int(np.argmax(dist))])
knee_tab = pd.DataFrame({"worst_gap_mean": worst, "x_norm": x, "y_norm": y.to_numpy(), "dist": dist})
print("\nknee k =", knee_k, "최악 칸 평균 gap", round(worst[knee_k], 4), flush=True)

# ── 그림 ─────────────────────────────────────────────
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
plt.rcParams["font.family"] = ["Malgun Gothic", "AppleGothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False
names = {"exaone": "K-EXAONE 2.5", "deepseek": "DeepSeek V4.1 Flash", "haiku": "Claude Haiku 5.5"}
colors = {"exaone": "#d95f02", "deepseek": "#1b9e77", "haiku": "#7570b3"}
titles = {"c0": "c0 (페르소나 없음)", "L0": "L0 (한국 성인)", "L1": "L1 (성별×연령)"}
(HERE / "out").mkdir(exist_ok=True)

fig, axes = plt.subplots(2, 2, figsize=(12, 8.5), sharex=True)
for ax, lv in zip(axes.flat[:3], sl.LEVELS):
    for m in models:
        c = curve[(curve.model == m) & (curve.level == lv)]
        ax.plot(c.k, c.p_ok, "-", color=colors[m], label=names.get(m, m), lw=1.8)
        ax.plot(c.k, c.p_ok_strict, ":", color=colors[m], lw=1.2)
        cg = cut[(cut.model == m) & (cut.level == lv)].iloc[0]
        if cg.cutoff_grid is not None and not pd.isna(cg.cutoff_grid):
            ax.axvline(cg.cutoff_grid, color=colors[m], ls="--", lw=0.8)
            ax.annotate(f"{int(cg.cutoff_grid)}", (cg.cutoff_grid, 0.03), color=colors[m], fontsize=9,
                        ha="center", fontweight="bold")
    ax.axhline(P_TARGET, color="gray", ls="--", lw=1)
    ax.set_title(titles[lv])
    ax.set_ylim(-0.02, 1.05)
    ax.set_ylabel("재현 확률 P(gap ≤ 허용치)")
    ax.grid(alpha=0.3)
axes[0, 0].legend(fontsize=8, loc="center right", title="실선 0.01 · 점선 0.005", title_fontsize=8)
ax = axes[1, 1]
for lv, ls in zip(sl.LEVELS, ["-", "--", ":"]):
    g = order[order.level == lv]
    ax.plot(g.k, g.p_order, ls, color="black", label=f"{lv} (cut-off {order_cut[lv]})")
ax.axhline(P_TARGET, color="gray", ls="--", lw=1)
ax.set_title("모델 순서 재현 확률")
ax.set_ylim(-0.02, 1.05)
ax.legend(fontsize=8)
ax.grid(alpha=0.3)
for a in axes[1]:
    a.set_xlabel("프롬프트당 표본 수 k")
fig.suptitle(f"k cut-off: 재현 확률이 {P_TARGET:.0%} 이상으로 유지되는 최소 k (전체 {overall['cutoff_grid']})")
fig.tight_layout()
fig.savefig(HERE / "out/cutoff.png", dpi=130)

fig, ax = plt.subplots(figsize=(7.5, 5))
for m in models:
    for lv, ls in zip(sl.LEVELS, ["-", "--", ":"]):
        c = curve[(curve.model == m) & (curve.level == lv)]
        ax.plot(c.k / 100, c.gap_mean, ls, color=colors[m], lw=1, alpha=0.7,
                label=f"{names.get(m, m)} {lv}")
ax.plot(worst.index / 100, worst, "k-", lw=2.2, label="최악 칸")
ax.plot([knee_k / 100], [worst[knee_k]], "o", ms=11, mfc="none", mec="red", mew=2)
ax.annotate(f"knee k={knee_k}", (knee_k / 100, worst[knee_k]), textcoords="offset points", xytext=(10, 12),
            color="red", fontweight="bold")
if overall["cutoff_grid"] is not None:
    ax.axvline(overall["cutoff_grid"] / 100, color="gray", ls="--", lw=1)
    ax.annotate(f"cut-off k={overall['cutoff_grid']}", (overall["cutoff_grid"] / 100, worst.max()),
                color="gray", ha="left", xytext=(4, 0), textcoords="offset points")
ax.axhline(TOL, color="gray", ls=":", lw=1)
ax.set_xlabel("상대 비용 (k / 100)")
ax.set_ylabel("평균 오차 (TVD_k − TVD_full)")
ax.set_title("비용–오차 곡선")
ax.legend(fontsize=6.5, ncol=2)
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(HERE / "out/cost_error.png", dpi=130)

tables = {"reps": r.set_index(["model", "level", "k", "rep"]),
          "curve": curve.set_index(["model", "level", "k"]),
          "cutoff_by_cell": cut.set_index(["model", "level"]),
          "order_by_k": order.set_index(["level", "k"]),
          "order_pairs": pd.DataFrame(pair_rows).set_index(["level", "pair"]),
          "knee": knee_tab,
          "full_data_tvd": full_tab}
run = sl.save_run(HERE / "out", tables=tables, params={
    "ks": KS, "reps": REPS, "tol": TOL, "tol_strict": TOL_STRICT, "p_target": P_TARGET, "tie": TIE,
    "n_boot": N_BOOT, "alpha": sl.ALPHA, "beta_full": beta_full, "overall": overall,
    "order_cutoff": order_cut, "order_cutoff_all": order_cut_all, "knee_k": knee_k})
print(f"\n기록: {HERE / 'out/run.json'} (commit {run['git_commit']}, dirty={run['git_dirty']})")
