const equations = [
  { className: 'algebraic-backdrop__equation--one', text: 'x + 5' },
  { className: 'algebraic-backdrop__equation--two', text: '2(x + 3)' },
  { className: 'algebraic-backdrop__equation--three', text: '3x − 4' },
  { className: 'algebraic-backdrop__equation--four', text: 'x ÷ 2' },
  { className: 'algebraic-backdrop__equation--five', text: 'x + y' },
  { className: 'algebraic-backdrop__equation--six', text: '4x + 1' },
  { className: 'algebraic-backdrop__equation--seven', text: '→' },
];

/** A non-interactive, shell-level chalk mark treatment for student pages. */
export function AlgebraicBackdrop() {
  return (
    <div className="algebraic-backdrop" aria-hidden="true">
      {equations.map((equation) => (
        <span
          key={equation.className}
          className={`algebraic-backdrop__equation ${equation.className}`}
        >
          {equation.text}
        </span>
      ))}
    </div>
  );
}
