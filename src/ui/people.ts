const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#FF4F8B', fg: '#1B1340' },
  { bg: '#3B4BFF', fg: '#FFFFFF' },
  { bg: '#20C9A0', fg: '#1B1340' },
  { bg: '#FF8A3D', fg: '#1B1340' },
  { bg: '#8B5CF6', fg: '#FFFFFF' },
  { bg: '#0EA5E9', fg: '#1B1340' },
  { bg: '#A3E635', fg: '#1B1340' },
  { bg: '#F472B6', fg: '#1B1340' },
];

/** A stable colour for each person, so you can follow them through a conversation. */
export function personColor(id: string): { bg: string; fg: string } {
  if (id === 'coordinator') return { bg: '#1B1340', fg: '#FFD23F' };
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
