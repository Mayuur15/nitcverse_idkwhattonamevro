export class Minimap {
  constructor(canvas, world) { this.c = canvas; this.g = canvas.getContext('2d'); this.world = world; this.t = 0; this.R = 170; }
  update(dt, px, pn, heading, peds, cars) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.12;
    const { g, c, R } = this, S = c.width / 2 / R, cx = c.width / 2, cy = c.height / 2;
    const X = (x) => cx + (x - px) * S, Y = (n) => cy - (n - pn) * S;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#243020'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#8a8a84'; g.lineWidth = 2;
    g.beginPath();
    for (const s of this.world.segs) {
      if (Math.abs(s.x1 - px) > R * 1.2 || Math.abs(s.y1 - pn) > R * 1.2) continue;
      g.moveTo(X(s.x1), Y(s.y1)); g.lineTo(X(s.x2), Y(s.y2));
    }
    g.stroke();
    g.fillStyle = '#d8cfba';
    for (const b of this.world.colliders) {
      if (b.maxX < px - R || b.minX > px + R || b.maxY < pn - R || b.minY > pn + R) continue;
      g.beginPath(); b.poly.forEach(([x, n], i) => (i ? g.lineTo(X(x), Y(n)) : g.moveTo(X(x), Y(n)))); g.closePath(); g.fill();
    }
    g.fillStyle = '#ffffff';
    for (const p of peds.list) { const x = X(p.obj.position.x), y = Y(-p.obj.position.z); if (Math.hypot(x - cx, y - cy) < c.width / 2) g.fillRect(x - 1, y - 1, 2.5, 2.5); }
    g.fillStyle = '#ffb347';
    for (const p of cars.list) { const x = X(p.obj.position.x), y = Y(-p.obj.position.z); if (Math.hypot(x - cx, y - cy) < c.width / 2) g.fillRect(x - 2, y - 2, 4, 4); }
    g.save(); g.translate(cx, cy); g.rotate(-heading); g.fillStyle = '#ff3b3b';
    g.beginPath(); g.moveTo(0, 7); g.lineTo(-5, -5); g.lineTo(5, -5); g.closePath(); g.fill(); g.restore();
    g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.fillText('N', cx - 4, 12);
  }
}
