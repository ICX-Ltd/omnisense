<script setup lang="ts">
import { computed } from "vue";

// Hand-rolled SVG donut (no chart lib in this project — see ParityBar.vue).
// Renders volume-by-outcome with a legend; collapses the long tail into "Other"
// so the ring stays readable, and optionally shows a compare-period % per slice.
const props = defineProps<{
  data: Array<{ label: string; count: number }>;
  compareData?: Array<{ label: string; count: number }> | null;
  size?: number; // rendered px (internal geometry is a fixed 160 viewBox)
  maxSlices?: number; // collapse beyond this into "Other"
}>();

// Distinct, reused-friendly palette. Indexed by slice order.
const PALETTE = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#0ea5e9",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b",
];

// Fixed internal coordinate system; `size` just scales the rendered SVG.
const CENTER = 80;
const RADIUS = 60;
const STROKE = 26;
const CIRC = 2 * Math.PI * RADIUS;

const size = computed(() => props.size ?? 168);

// Sort desc and fold the tail into a single "Other" slice.
const slices = computed(() => {
  const sorted = [...(props.data ?? [])]
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
  const max = props.maxSlices ?? 8;
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1).reduce((s, d) => s + d.count, 0);
  return [...head, { label: "Other", count: tail }];
});

const total = computed(() => slices.value.reduce((s, d) => s + d.count, 0));

const compareMap = computed(() => {
  const m = new Map<string, number>();
  for (const d of props.compareData ?? []) m.set(d.label, d.count);
  return m;
});
const compareTotal = computed(() =>
  (props.compareData ?? []).reduce((s, d) => s + d.count, 0),
);

// Pre-compute arc geometry (dasharray / offset) per slice.
const arcs = computed(() => {
  let acc = 0;
  return slices.value.map((d, i) => {
    const frac = total.value ? d.count / total.value : 0;
    const len = frac * CIRC;
    const arc = {
      label: d.label,
      count: d.count,
      color: PALETTE[i % PALETTE.length],
      pct: Math.round(frac * 100),
      dasharray: `${len} ${CIRC - len}`,
      dashoffset: -acc,
    };
    acc += len;
    return arc;
  });
});

function pct(n: number, t: number) {
  return t ? Math.round((n / t) * 100) : 0;
}
</script>

<template>
  <div class="donut">
    <div class="donut-chart">
      <svg
        v-if="total > 0"
        :width="size"
        :height="size"
        viewBox="0 0 160 160"
        class="donut-svg"
      >
        <g :transform="`translate(${CENTER}, ${CENTER}) rotate(-90)`">
          <circle :r="RADIUS" fill="none" :stroke-width="STROKE" class="donut-track" />
          <circle
            v-for="a in arcs"
            :key="a.label"
            :r="RADIUS"
            fill="none"
            :stroke="a.color"
            :stroke-width="STROKE"
            :stroke-dasharray="a.dasharray"
            :stroke-dashoffset="a.dashoffset"
            stroke-linecap="butt"
          >
            <title>{{ a.label }}: {{ a.count }} ({{ a.pct }}%)</title>
          </circle>
        </g>
        <text :x="CENTER" :y="CENTER - 4" text-anchor="middle" class="donut-center-num">{{ total }}</text>
        <text :x="CENTER" :y="CENTER + 14" text-anchor="middle" class="donut-center-label">total</text>
      </svg>
      <div v-else class="donut-empty">No data</div>
    </div>

    <div class="donut-legend">
      <div v-for="a in arcs" :key="a.label" class="donut-legend-row">
        <span class="donut-dot" :style="{ background: a.color }" />
        <span class="donut-legend-label" :title="a.label">{{ a.label }}</span>
        <span class="donut-legend-count">{{ a.count }}</span>
        <span class="donut-legend-pct">{{ a.pct }}%</span>
        <span
          v-if="compareData"
          class="donut-legend-cmp"
          :title="'Compare period: ' + (compareMap.get(a.label) ?? 0)"
        >vs {{ pct(compareMap.get(a.label) ?? 0, compareTotal) }}%</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: 22px;
  flex-wrap: wrap;
}
.donut-chart {
  flex: 0 0 auto;
}
.donut-svg {
  display: block;
}
.donut-track {
  stroke: color-mix(in srgb, var(--ink) 8%, transparent);
}
.donut-svg circle {
  transition: stroke-dasharray 0.35s ease, stroke-dashoffset 0.35s ease;
}
.donut-center-num {
  fill: var(--ink);
  font-size: 26px;
  font-weight: 900;
}
.donut-center-label {
  fill: var(--muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.donut-empty {
  width: 168px;
  height: 168px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
}
.donut-legend {
  flex: 1 1 240px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.donut-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.donut-dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.donut-legend-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}
.donut-legend-count {
  flex: 0 0 auto;
  font-weight: 800;
  color: var(--ink);
}
.donut-legend-pct {
  flex: 0 0 auto;
  width: 38px;
  text-align: right;
  color: var(--muted);
}
.donut-legend-cmp {
  flex: 0 0 auto;
  width: 58px;
  text-align: right;
  color: var(--muted);
  font-size: 11px;
}
</style>
