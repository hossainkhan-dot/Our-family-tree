/** Golden ancestor funnel: ancestors at the top, lines flow down and converge on "you". */
interface Props { gen: number; unknown?: boolean }

const W = 360, H = 460, CX = W / 2, Y_TOP = 40, Y_BOT = H - 70;

const levelY = (k: number, gen: number) => Y_BOT - (Y_BOT - Y_TOP) * (1 - Math.pow(1 - k / gen, 1.6));
const levelX = (k: number, i: number, gen: number) => {
  const n = 2 ** k;
  if (n === 1) return CX;
  const width = 50 + (W - 70) * (k / gen);
  return CX + (i - (n - 1) / 2) * (width / (n - 1));
};

export default function Funnel({ gen, unknown = false }: Props) {
  const paths: JSX.Element[] = [];
  const dots: JSX.Element[] = [];
  for (let k = 0; k < gen; k++) {
    const n = 2 ** k;
    const delay = (gen - 1 - k) * 0.45;
    for (let i = 0; i < n; i++) {
      for (const p of [2 * i, 2 * i + 1]) {
        const xc = levelX(k, i, gen), yc = levelY(k, gen);
        const xp = levelX(k + 1, p, gen), yp = levelY(k + 1, gen);
        const ym = (yp + yc) / 2;
        paths.push(
          <path
            key={`${k}-${p}`}
            className={unknown ? "tree-line placeholder" : "tree-line draw"}
            pathLength={1}
            style={{ animationDelay: `${delay + (p % 4) * 0.04}s` }}
            strokeOpacity={0.95 - 0.5 * (k / gen)}
            strokeWidth={1.4 - 0.6 * (k / gen)}
            d={`M${xp} ${yp} C${xp} ${ym}, ${xc} ${ym}, ${xc} ${yc}`}
          />
        );
        dots.push(<circle key={`d${k}-${p}`} cx={xp} cy={yp} r={unknown ? 3 : 1.7} className={unknown ? "dot-unknown" : "dot-gold"} />);
      }
    }
  }
  return (
    <svg className="funnel" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="বংশধারার চিত্র">
      <defs>
        <radialGradient id="you-glow">
          <stop offset="0" stopColor="#f0d78c" stopOpacity=".55" />
          <stop offset="1" stopColor="#d4af37" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={Y_BOT} r="48" fill="url(#you-glow)" />
      {paths}
      {dots}
      <circle cx={CX} cy={Y_BOT} r="5.5" fill="#fff6dc" />
      <text x={CX} y={Y_BOT + 34} textAnchor="middle" className="you-label">আপনি</text>
    </svg>
  );
}
