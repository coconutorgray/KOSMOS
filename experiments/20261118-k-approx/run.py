"""20261118-k-approx — 실행: PYTHONUTF8=1 python experiments/20261118-k-approx/run.py  (KOSMOS 루트에서, 약 30~40분)
작은 k 부분표본 하나만 보고 전체 데이터(k≈100)의 보정 후 validation TVD를 근사한다.
M0 그대로 / M1 모수적 부트스트랩 편향 보정 / M2 리처드슨(1/n) 외삽."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "research/design_v2_20261112/dataset"))
import silicon as sl  # noqa: E402

KS = [10, 20, 30, 40, 50]
REPS = 20
B = 15            # M1 부트스트랩 횟수
M2_SUB = 5        # M2 k/2 재추출 횟수
BETAS = np.round(np.arange(0.05, 1.5001, 0.01), 3)
TOL, TOL_STRICT, P_TARGET = 0.01, 0.005, 0.9
METHODS = ["M0", "M1", "M2"]
MNAME = {"M0": "M0 그대로", "M1": "M1 부트스트랩 편향 보정", "M2": "M2 리처드슨 외삽"}

# ── 데이터와 빠른 채점기 (20261118-k-cutoff와 같음) ─────────
df = sl.load()                                   # test 제외
df = df.sort_values(sl.KEY + ["opt_idx"], kind="stable").reset_index(drop=True)
gid = df.groupby(sl.KEY, sort=False).ngroup().to_numpy()
starts = np.flatnonzero(np.r_[True, gid[1:] != gid[:-1]])
assert len(starts) == gid.max() + 1, "그룹이 연속이 아님"
sizes = np.diff(np.r_[starts, len(df)])
G = df.iloc[starts][["model", "level", "var", "split"]].reset_index(drop=True)
counts0 = df["count"].to_numpy()
human = df["human_p"].to_numpy()
pos = np.arange(len(df)) - np.repeat(starts, sizes)        # 그룹 안 보기 위치
M_MAX = int(sizes.max())


def make_split(split):
    sel = G.index[G["split"] == split].to_numpy()
    g = G.loc[sel]
    order = np.lexsort((g["var"].to_numpy(), g["level"].to_numpy(), g["model"].to_numpy()))
    sel, g = sel[order], g.iloc[order].reset_index(drop=True)
    mlv = (g["model"] + "|" + g["level"] + "|" + g["var"]).to_numpy()
    mlv_st = np.flatnonzero(np.r_[True, mlv[1:] != mlv[:-1]])
    mlv_n = np.diff(np.r_[mlv_st, len(g)])
    ml_of_mlv = (g["model"] + "|" + g["level"]).to_numpy()[mlv_st]
    ml_st = np.flatnonzero(np.r_[True, ml_of_mlv[1:] != ml_of_mlv[:-1]])
    ml_n = np.diff(np.r_[ml_st, len(ml_of_mlv)])
    labels = [tuple(s.split("|")) for s in ml_of_mlv[ml_st]]
    return dict(sel=sel, mlv_st=mlv_st, mlv_n=mlv_n, ml_st=ml_st, ml_n=ml_n, labels=labels)


SPL = {s: make_split(s) for s in ("calibration", "validation")}
LABELS = SPL["calibration"]["labels"]
assert LABELS == SPL["validation"]["labels"]
NL = len(LABELS)


def level_tvd(counts, sp, betas):
    """(len(betas), 모델×단계): silicon.level_mean(score(calibrate(...)))과 같은 값."""
    X = (counts + sl.ALPHA)[None, :] ** betas[:, None]
    S = np.add.reduceat(X, starts, axis=1)
    P = X / np.repeat(S, sizes, axis=1)
    T = 0.5 * np.add.reduceat(np.abs(P - human[None, :]), starts, axis=1)[:, sp["sel"]]
    per_item = np.add.reduceat(T, sp["mlv_st"], axis=1) / sp["mlv_n"]
    return np.add.reduceat(per_item, sp["ml_st"], axis=1) / sp["ml_n"]


def val_tvd(counts):
    """calibration에서 β 선택 → validation TVD. 반환: 길이 NL 배열(LABELS 순서), β 배열."""
    counts = np.asarray(counts, float)
    bsel = BETAS[level_tvd(counts, SPL["calibration"], BETAS).argmin(axis=0)]
    u, inv = np.unique(bsel, return_inverse=True)
    val = level_tvd(counts, SPL["validation"], u)[inv, np.arange(NL)]
    return val, bsel


# ── 목표값 + silicon과 같은지 확인 ─────────────────────
full, beta_full = val_tvd(counts0)
ref_beta = sl.fit_beta(df, betas=BETAS)
ref = sl.summary(df[df["split"] == "validation"], ref_beta)
for j, (m, lv) in enumerate(LABELS):
    assert abs(beta_full[j] - ref_beta[(m, lv)]) < 1e-9, ("β 불일치", m, lv)
    assert abs(full[j] - ref.loc[m, lv]) < 1e-9, ("TVD 불일치", m, lv)
print("silicon과 일치 확인", flush=True)
n_full_group = np.add.reduceat(counts0, starts)                       # 프롬프트별 전체 유효 응답 수
k_full_model = G.assign(n=n_full_group).groupby("model")["n"].median()
K_FULL = np.array([k_full_model[m] for m, _ in LABELS], float)
print(pd.Series(full, index=pd.MultiIndex.from_tuples(LABELS)).unstack().round(4), flush=True)


# ── 추출 도구 ────────────────────────────────────────
def hyper(counts, k, rng):
    """그룹마다 k개 비복원 추출(그룹 크기가 k 이하면 그대로)."""
    new = counts.copy()
    for s, n in zip(starts, sizes):
        c = counts[s:s + n]
        if int(c.sum()) > k:
            new[s:s + n] = rng.multivariate_hypergeometric(c, k)
    return new


def multinom(p_rows, n_group, rng):
    """행별 확률 p_rows(평탄)·그룹별 표본 수로 다항 추출."""
    P = np.zeros((len(starts), M_MAX))
    P[np.repeat(np.arange(len(starts)), sizes), pos] = p_rows
    draw = rng.multinomial(n_group.astype(np.int64), P)
    return draw[np.repeat(np.arange(len(starts)), sizes), pos]


def jeffreys(counts):
    c = counts + 0.5
    return c / np.repeat(np.add.reduceat(c, starts), sizes)


# ── 반복 ─────────────────────────────────────────────
rows = []
for ki, k in enumerate(KS):
    for rep in range(REPS):
        rng = np.random.default_rng(200_000 + 1000 * ki + rep)
        sub = hyper(counts0, k, rng)
        m0, beta0 = val_tvd(sub)
        # M1
        p_hat = jeffreys(sub.astype(float))
        n_sub = np.add.reduceat(sub, starts)
        tk = np.mean([val_tvd(multinom(p_hat, n_sub, rng))[0] for _ in range(B)], axis=0)
        tK = np.mean([val_tvd(multinom(p_hat, n_full_group, rng))[0] for _ in range(B)], axis=0)
        bias = tk - tK
        m1 = m0 - bias
        # M2
        h = k // 2
        th = np.mean([val_tvd(hyper(sub, h, rng))[0] for _ in range(M2_SUB)], axis=0)
        a = (th - m0) / (1 / h - 1 / k)
        c = m0 - a / k
        m2 = c + a / K_FULL
        for j, (m, lv) in enumerate(LABELS):
            rows.append(dict(k=k, rep=rep, model=m, level=lv, tvd_full=full[j], beta_k=beta0[j],
                             M0=m0[j], M1=m1[j], M2=m2[j], bias_hat=bias[j], tvd_half=th[j]))
    print("k =", k, "완료", flush=True)

r = pd.DataFrame(rows)
long = r.melt(id_vars=["k", "rep", "model", "level", "tvd_full"], value_vars=METHODS,
              var_name="method", value_name="est")
long["err"] = long["est"] - long["tvd_full"]
long["ok"] = long["err"].abs() <= TOL
long["ok_strict"] = long["err"].abs() <= TOL_STRICT
summ = long.groupby(["method", "model", "level", "k"]).agg(
    err_mean=("err", "mean"), err_sd=("err", "std"), rmse=("err", lambda e: float(np.sqrt((e ** 2).mean()))),
    p_ok=("ok", "mean"), p_ok_strict=("ok_strict", "mean")).reset_index()

worst = summ.groupby(["method", "k"]).agg(p_ok_min=("p_ok", "min"), p_ok_strict_min=("p_ok_strict", "min"),
                                          abs_bias_mean=("err_mean", lambda e: e.abs().mean()),
                                          rmse_max=("rmse", "max")).reset_index()


def cutoff(g, col):
    ok = g[g[col] >= P_TARGET]["k"]
    return int(ok.min()) if len(ok) else None


cut = {m: {"tol_0.01": cutoff(worst[worst.method == m], "p_ok_min"),
           "tol_0.005": cutoff(worst[worst.method == m], "p_ok_strict_min")} for m in METHODS}
b30 = worst[worst.k == 30].set_index("method")["abs_bias_mean"]
verdict = {"H1_M1_cutoff": cut["M1"]["tol_0.01"],
           "H1_supported": cut["M1"]["tol_0.01"] is not None and cut["M1"]["tol_0.01"] <= 30,
           "H2_abs_bias_k30": b30.to_dict(), "H2_supported": bool(b30["M1"] <= 0.5 * b30["M0"])}
print("\n[방법×k 최악 칸]\n", worst.round(4).to_string(), "\n근사 cut-off:", cut, "\n판정:", verdict, flush=True)

# ── 그림 ─────────────────────────────────────────────
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
plt.rcParams["font.family"] = ["Malgun Gothic", "AppleGothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False
mcol = {"M0": "#888888", "M1": "#d62728", "M2": "#1f77b4"}
names = {"exaone": "EXAONE", "deepseek": "DeepSeek", "haiku": "Haiku"}
(HERE / "out").mkdir(exist_ok=True)

models = sorted({m for m, _ in LABELS})
fig, axes = plt.subplots(3, 3, figsize=(13, 10), sharex=True, sharey=True)
for i, m in enumerate(models):
    for jj, lv in enumerate(sl.LEVELS):
        ax = axes[i, jj]
        for meth in METHODS:
            s = summ[(summ.method == meth) & (summ.model == m) & (summ.level == lv)]
            ax.plot(s.k, s.err_mean, "-o", ms=3.5, color=mcol[meth], label=MNAME[meth])
            ax.fill_between(s.k, s.err_mean - s.err_sd, s.err_mean + s.err_sd, color=mcol[meth], alpha=0.12)
        ax.axhline(0, color="black", lw=0.8)
        for t in (TOL, -TOL):
            ax.axhline(t, color="gray", ls="--", lw=0.8)
        ax.set_title(f"{names.get(m, m)} · {lv}", fontsize=10)
        ax.grid(alpha=0.3)
        if i == 2:
            ax.set_xlabel("부분표본 k")
        if jj == 0:
            ax.set_ylabel("추정 − k=100 값")
axes[0, 0].legend(fontsize=8)
fig.suptitle("작은 k로 k=100의 보정 후 validation TVD 근사: 오차 평균±sd (점선 ±0.01)")
fig.tight_layout()
fig.savefig(HERE / "out/approx_error.png", dpi=130)

fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
for meth in METHODS:
    w = worst[worst.method == meth]
    axes[0].plot(w.k, w.p_ok_min, "-o", color=mcol[meth], label=f"{MNAME[meth]} (cut-off {cut[meth]['tol_0.01']})")
    axes[1].plot(w.k, w.p_ok_strict_min, "-o", color=mcol[meth],
                 label=f"{MNAME[meth]} (cut-off {cut[meth]['tol_0.005']})")
for ax, t in zip(axes, ["허용 오차 0.01", "허용 오차 0.005"]):
    ax.axhline(P_TARGET, color="gray", ls="--", lw=1)
    ax.set_ylim(-0.02, 1.05)
    ax.set_xlabel("부분표본 k")
    ax.set_ylabel("9칸 중 최악 칸의 근사 성공 확률")
    ax.set_title(t)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
fig.suptitle("근사 cut-off: 최악 칸에서도 90% 이상 맞히는 최소 k")
fig.tight_layout()
fig.savefig(HERE / "out/approx_cutoff.png", dpi=130)

tables = {"reps": r.set_index(["model", "level", "k", "rep"]),
          "summary": summ.set_index(["method", "model", "level", "k"]),
          "worst_by_k": worst.set_index(["method", "k"]),
          "full_data_tvd": pd.Series(full, index=pd.MultiIndex.from_tuples(LABELS, names=["model", "level"]),
                                     name="tvd_full").to_frame()}
run = sl.save_run(HERE / "out", tables=tables, params={
    "ks": KS, "reps": REPS, "B": B, "m2_sub": M2_SUB, "tol": TOL, "tol_strict": TOL_STRICT,
    "p_target": P_TARGET, "alpha": sl.ALPHA, "k_full_model": k_full_model.to_dict(), "cutoff": cut,
    "verdict": verdict})
print(f"\n기록: {HERE / 'out/run.json'} (commit {run['git_commit']}, dirty={run['git_dirty']})")
