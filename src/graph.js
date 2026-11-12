import { project } from './geo.js';

export const WALKABLE = new Set(['footway', 'path', 'pedestrian', 'steps', 'residential', 'service', 'tertiary', 'unclassified', 'track', 'living_street', 'cycleway', 'secondary', 'primary']);
export const DRIVABLE = new Set(['residential', 'service', 'tertiary', 'unclassified', 'living_street', 'secondary', 'primary']);

export class Graph {
  constructor() { this.map = new Map(); this.list = []; }
  node(c) {
    const k = c[0] + ',' + c[1];
    let nd = this.map.get(k);
    if (!nd) {
      const [x, n] = project(c[0], c[1]);
      nd = { id: this.list.length, x, n, adj: [] };
      this.map.set(k, nd); this.list.push(nd);
    }
    return nd;
  }
  link(a, b) {
    if (a === b) return;
    if (!a.adj.includes(b)) a.adj.push(b);
    if (!b.adj.includes(a)) b.adj.push(a);
  }
}

export function buildGraph(features, allowed) {
  const g = new Graph();
  for (const f of features) {
    const p = f.properties;
    if (f.geometry.type !== 'LineString' || !allowed.has(p.highway) || p.indoor) continue;
    const c = f.geometry.coordinates;
    for (let i = 0; i < c.length - 1; i++) g.link(g.node(c[i]), g.node(c[i + 1]));
  }
  return g;
}
