import { initial, personColor } from './people';

export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const c = personColor(id);
  return (
    <span className="avatar" style={{ background: c.bg, color: c.fg, width: size, height: size, fontSize: size * 0.46 }} aria-hidden="true">
      {id === 'coordinator' ? 'R' : initial(name)}
    </span>
  );
}
