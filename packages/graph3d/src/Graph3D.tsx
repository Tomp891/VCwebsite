import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData } from "@atlas/contracts";
import ForceGraph3D from "3d-force-graph";
import type { ForceGraph3DInstance, NodeObject, LinkObject } from "3d-force-graph";
import * as THREE from "three";
import { tokens, clusterColor } from "./tokens.js";
import { toLayeredGraph } from "./synthesize.js";
import type { AtlasNode, AtlasLink, LayeredGraph } from "./synthesize.js";
import { compileFilter } from "./filter.js";
import type { CompiledFilter, FilterMode, GraphFilter } from "./filter.js";
import { FilterControls } from "./FilterControls.js";
import "./graph3d.css";

export interface Graph3DProps {
  data: GraphData;
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** optional declarative filter; when omitted the full graph is shown. */
  filter?: GraphFilter;
  /** render the built-in parchment filter panel (self-manages filter state). */
  showControls?: boolean;
  /** notified whenever the effective filter changes (useful with `showControls`). */
  onFilterChange?: (filter: GraphFilter) => void;
}

type Coords3 = { x: number; y: number; z: number };

/** Minimal shape of the OrbitControls object we drive for gentle auto-rotation. */
interface OrbitLikeControls {
  autoRotate: boolean;
  autoRotateSpeed: number;
  enableDamping: boolean;
  dampingFactor: number;
  target: THREE.Vector3;
  update: () => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A serif text label rendered to a canvas texture so it can float in 3D. */
function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const fontSize = 28;
  const padding = 8;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Sprite();

  const font = `italic ${fontSize}px Georgia, "Times New Roman", serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const width = Math.ceil(metrics.width) + padding * 2;
  const height = fontSize + padding * 2;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // faint parchment plate behind text for legibility over busy edges.
  ctx.fillStyle = hexToRgba(tokens.parchment, 0.72);
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 11;
  sprite.scale.set((width / height) * worldHeight, worldHeight, 1);
  return sprite;
}

function nodeRadius(node: AtlasNode): number {
  const base = node.kind === "domain" ? 9 : node.kind === "concept" ? 6.5 : 4;
  return base + Math.sqrt(Math.max(0, node.weight)) * (node.kind === "block" ? 1.6 : 1.1);
}

function nodeGeometry(node: AtlasNode): THREE.BufferGeometry {
  if (node.kind === "domain") return new THREE.OctahedronGeometry(nodeRadius(node), 0);
  if (node.kind === "concept") return new THREE.IcosahedronGeometry(nodeRadius(node), 0);
  return new THREE.SphereGeometry(nodeRadius(node), 20, 16);
}

function buildNodeObject(node: AtlasNode, selected: boolean, dimmed: boolean): THREE.Object3D {
  const group = new THREE.Group();
  // dimmed nodes fade toward parchment, like an erased pencil mark on the map.
  const baseColor = node.kind === "block" ? clusterColor(node.cluster) : tokens.ink;
  const color = dimmed ? new THREE.Color(baseColor).lerp(new THREE.Color(tokens.parchment), 0.72) : new THREE.Color(baseColor);

  const material = new THREE.MeshLambertMaterial({
    color,
    emissive: new THREE.Color(selected ? tokens.oxblood : "#000000"),
    emissiveIntensity: selected ? 0.6 : 0,
    transparent: dimmed,
    opacity: dimmed ? 0.35 : 1,
  });
  const mesh = new THREE.Mesh(nodeGeometry(node), material);
  group.add(mesh);

  if (selected) {
    // circle the node like a landmark marked on an old map.
    const r = nodeRadius(node);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.6, r * 1.9, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tokens.oxblood), transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    group.add(ring);
  }

  const label = makeLabelSprite(node.label, dimmed ? tokens.pencil : tokens.ink);
  label.position.set(0, nodeRadius(node) + 8, 0);
  if (dimmed) label.material.opacity = 0.4;
  group.add(label);
  return group;
}

/** A faint dashed "pencil" line for ambient AI edges. */
function buildPencilLine(dimmed: boolean): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const material = new THREE.LineDashedMaterial({
    color: new THREE.Color(tokens.pencil),
    dashSize: 6,
    gapSize: 5,
    transparent: true,
    opacity: dimmed ? 0.15 : 0.7,
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  return line;
}

export function Graph3D({ data, selectedId, onSelect, filter, showControls, onFilterChange }: Graph3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const selectedRef = useRef<string | undefined>(selectedId);
  const onSelectRef = useRef<Graph3DProps["onSelect"]>(onSelect);
  const layeredRef = useRef<LayeredGraph | null>(null);
  const compiledRef = useRef<CompiledFilter>({ active: false, nodeActive: () => true, linkActive: () => true });
  const applyRef = useRef<(() => void) | null>(null);
  const prunedRef = useRef(false);

  // when showControls is on, the panel self-manages filter state (seeded from `filter`).
  const [panelFilter, setPanelFilter] = useState<GraphFilter>(() => filter ?? {});
  const [focusSelected, setFocusSelected] = useState(false);

  const clusters = useMemo(
    () => Array.from(new Set(data.nodes.map((n) => n.cluster))).sort((a, b) => a - b),
    [data],
  );

  const effectiveFilter: GraphFilter | undefined = showControls
    ? { ...panelFilter, focusId: focusSelected ? selectedId : undefined }
    : filter;

  const filterRef = useRef<GraphFilter | undefined>(effectiveFilter);

  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  filterRef.current = effectiveFilter;

  const recompute = () => {
    if (layeredRef.current) {
      compiledRef.current = compileFilter(layeredRef.current, filterRef.current);
    }
  };

  // create the instance once.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    // ForceGraph3D replaces its mount element's children, so give it a dedicated
    // inner div and keep the caption/legend as siblings in the outer container.
    const fg = new ForceGraph3D(el, { controlType: "orbit" });
    graphRef.current = fg;

    const mode = (): FilterMode => filterRef.current?.mode ?? "dim";
    const nodeDimmed = (node: AtlasNode) =>
      compiledRef.current.active && mode() === "dim" && !compiledRef.current.nodeActive(node);
    const linkDimmed = (link: AtlasLink) =>
      compiledRef.current.active && mode() === "dim" && !compiledRef.current.linkActive(link);

    const nodeThree = (n: NodeObject): THREE.Object3D => {
      const node = n as AtlasNode;
      return buildNodeObject(node, node.id === selectedRef.current, nodeDimmed(node));
    };
    const nodeVis = (n: NodeObject): boolean => {
      const node = n as AtlasNode;
      return !(compiledRef.current.active && mode() === "hide" && !compiledRef.current.nodeActive(node));
    };
    const linkThree = (l: LinkObject): THREE.Object3D => {
      const link = l as AtlasLink;
      if (link.style !== "pencil") return false as unknown as THREE.Object3D;
      return buildPencilLine(linkDimmed(link));
    };
    const linkVis = (l: LinkObject): boolean => {
      const link = l as AtlasLink;
      return !(compiledRef.current.active && mode() === "hide" && !compiledRef.current.linkActive(link));
    };
    const linkCol = (l: LinkObject): string => {
      const link = l as AtlasLink;
      const dimmed = linkDimmed(link);
      if (link.style === "structure") return hexToRgba(tokens.line, dimmed ? 0.12 : 0.55);
      if (dimmed) return hexToRgba(tokens.pencil, 0.12);
      return hexToRgba(tokens.ink, 0.45 + link.confidence * 0.45);
    };
    const linkW = (l: LinkObject): number => {
      const link = l as AtlasLink;
      if (link.style === "pencil" || link.style === "structure") return 0;
      return linkDimmed(link) ? 0.3 : 0.7 + link.confidence * 1.4;
    };

    fg.backgroundColor(tokens.parchment)
      .showNavInfo(false)
      .nodeThreeObjectExtend(false)
      .nodeThreeObject(nodeThree)
      .nodeVisibility(nodeVis)
      .nodeLabel(() => "")
      .linkThreeObjectExtend(false)
      .linkThreeObject(linkThree)
      .linkVisibility(linkVis)
      .linkPositionUpdate((obj: THREE.Object3D, coords: { start: Coords3; end: Coords3 }, l: LinkObject) => {
        if ((l as AtlasLink).style !== "pencil") return false;
        const line = obj as THREE.Line;
        const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
        pos.setXYZ(0, coords.start.x, coords.start.y, coords.start.z);
        pos.setXYZ(1, coords.end.x, coords.end.y, coords.end.z);
        pos.needsUpdate = true;
        line.geometry.computeBoundingSphere();
        line.computeLineDistances();
        return true;
      })
      .linkColor(linkCol)
      .linkWidth(linkW)
      .linkOpacity(0.85)
      .onNodeClick((n: NodeObject) => onSelectRef.current?.((n as AtlasNode).id));

    // re-applies the visual accessors (idiomatic force-graph "refresh") so a filter
    // change redraws without rebuilding graphData (keeps node positions stable), and
    // frames the focused subset when a focus root is set.
    applyRef.current = () => {
      const layered = layeredRef.current;
      if (!layered) return;
      const compiled = compiledRef.current;

      // "prune" mode rebuilds graphData from the active set (lighter sim for large
      // graphs, at the cost of a relayout); dim/hide keep the full data for stable
      // positions. Only touch graphData when entering/leaving/refreshing a prune.
      const pruning = compiled.active && mode() === "prune";
      if (pruning) {
        const nodes = layered.nodes.filter((n) => compiled.nodeActive(n));
        const links = layered.links.filter((l) => compiled.linkActive(l));
        fg.graphData({ nodes: nodes as NodeObject[], links: links as LinkObject[] });
        prunedRef.current = true;
      } else if (prunedRef.current) {
        fg.graphData({ nodes: layered.nodes as NodeObject[], links: layered.links as LinkObject[] });
        prunedRef.current = false;
      }

      fg.nodeThreeObject(nodeThree)
        .nodeVisibility(nodeVis)
        .linkThreeObject(linkThree)
        .linkVisibility(linkVis)
        .linkColor(linkCol)
        .linkWidth(linkW);
      if (compiled.active && filterRef.current?.focusId) {
        fg.zoomToFit(700, 60, (n: NodeObject) => compiled.nodeActive(n as AtlasNode));
      }
    };

    // slow, gentle simulation and a warm sense of depth.
    fg.d3VelocityDecay(0.55).cooldownTime(6000);
    const scene = fg.scene();
    scene.fog = new THREE.Fog(new THREE.Color(tokens.parchment).getHex(), 260, 900);

    // isometric-ish view so the three stacked Z planes read clearly.
    fg.cameraPosition({ x: 360, y: 120, z: 440 }, { x: 0, y: 0, z: 120 }, 0);

    const controls = fg.controls() as unknown as OrbitLikeControls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.target.set(0, 0, 120);
    controls.update();

    const resize = () => {
      fg.width(el.clientWidth).height(el.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      observer.disconnect();
      fg._destructor();
      graphRef.current = null;
      applyRef.current = null;
      if (el.firstChild) el.replaceChildren();
    };
  }, []);

  // feed graph data (and adjacency) when it changes.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    const layered = toLayeredGraph(data);
    layeredRef.current = layered;
    fg.graphData({ nodes: layered.nodes as NodeObject[], links: layered.links as LinkObject[] });
    prunedRef.current = false;
    recompute();
    applyRef.current?.();
  }, [data]);

  // re-render node objects when selection changes (selection can drive focus).
  useEffect(() => {
    if (!graphRef.current) return;
    recompute();
    applyRef.current?.();
  }, [selectedId]);

  // re-apply filtering without rebuilding graphData (stable layout) when it changes.
  const filterKey = JSON.stringify(effectiveFilter ?? null);
  useEffect(() => {
    if (graphRef.current) {
      recompute();
      applyRef.current?.();
    }
    onFilterChange?.(effectiveFilter ?? {});
  }, [filterKey]);

  const patchPanelFilter = (patch: Partial<GraphFilter>) => setPanelFilter((prev) => ({ ...prev, ...patch }));

  return (
    <div ref={containerRef} className="atlas-graph3d">
      <div ref={canvasRef} className="atlas-graph3d__canvas" />
      <div className="atlas-graph3d__caption">Living Atlas — atoms · concepts · domain</div>
      {showControls && (
        <FilterControls
          value={panelFilter}
          clusters={clusters}
          focusSelected={focusSelected}
          hasSelection={!!selectedId}
          onChange={patchPanelFilter}
          onFocusToggle={setFocusSelected}
        />
      )}
      <div className="atlas-graph3d__legend">
        <div className="atlas-graph3d__legend-row">
          <span className="atlas-graph3d__swatch atlas-graph3d__swatch--ink" /> explicit · ink
        </div>
        <div className="atlas-graph3d__legend-row">
          <span className="atlas-graph3d__swatch atlas-graph3d__swatch--pencil" /> inferred · pencil
        </div>
      </div>
    </div>
  );
}
