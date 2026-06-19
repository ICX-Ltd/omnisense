<script setup lang="ts">
// Single 100%-width segmented bar used in the Parity campaign-analysis cards.
// Replaces the old stack of one `views-row` per bucket: instead of a separate
// chip+bar+%+count+toggle row for "negative" and another for "none", the buckets
// share one bar (red negative segment on the left, green none segment on the
// right) with a compact legend below. Works for any number of segments, so the
// yes/no/n_a circumstances cards render as a three-section bar.
//
// Segment widths are share-of-total, so any unanswered remainder shows as the
// empty track behind the segments (honest — the segments need not sum to 100%).
// Clicking a legend entry emits `toggle` with that bucket key; the parent owns
// the drill-down panels and open state.

import { computed } from "vue";

type Segment = {
  key: string;
  label: string;
  chipClass: string;
  color: string;
  count: number;
  compareCount?: number | null;
  open?: boolean;
};

const props = withDefaults(
  defineProps<{
    segments: Segment[];
    total: number | null | undefined;
    compareTotal?: number | null;
    // When false the legend is display-only — no chevrons, no click-to-drill.
    interactive?: boolean;
    // When true (and compare data exists) render a second bar for the comparison
    // period with its own stats repeated below, plus a per-segment difference row.
    detailedCompare?: boolean;
  }>(),
  { interactive: true, detailedCompare: false },
);

defineEmits<{ (e: "toggle", key: string): void }>();

// Share of a period total, rounded to whole %.
function pctOf(count: number | null | undefined, total: number | null | undefined): number {
  if (typeof count !== "number" || !total) return 0;
  return Math.round((count / total) * 100);
}
function pct(count: number | null | undefined): number {
  return pctOf(count, props.total);
}
function comparePct(s: Segment): number {
  return pctOf(s.compareCount, props.compareTotal);
}

const hasCompare = computed(
  () => props.compareTotal != null && props.segments.some((s) => s.compareCount != null),
);

// Expanded two-bar comparison view is only meaningful when we actually have
// comparison data to show.
const detailed = computed(() => props.detailedCompare && hasCompare.value);

// Per-segment period-over-period change: absolute volume (count) and share in
// percentage points. Returned pre-formatted with sign + direction.
function diff(s: Segment) {
  const prev = typeof s.compareCount === "number" ? s.compareCount : 0;
  const volAbs = s.count - prev;
  const ppAbs = pct(s.count) - comparePct(s);
  const dir = volAbs > 0 ? ("up" as const) : volAbs < 0 ? ("down" as const) : ("flat" as const);
  const sign = (n: number) => (n > 0 ? "+" : "") + n;
  return { dir, vol: sign(volAbs), pp: `${sign(ppAbs)}pp` };
}

// Direction + label for a segment's count vs its comparison-period count.
function cmp(s: Segment) {
  if (s.compareCount == null || typeof s.count !== "number") {
    return { dir: "flat" as const, label: "—" };
  }
  const abs = s.count - s.compareCount;
  const dir = abs > 0 ? ("up" as const) : abs < 0 ? ("down" as const) : ("flat" as const);
  let label = "0%";
  if (s.compareCount !== 0) {
    const p = (abs / s.compareCount) * 100;
    label = `${p > 0 ? "+" : ""}${p.toFixed(0)}%`;
  } else if (s.count !== 0) {
    label = "new";
  }
  return { dir, label };
}

function cmpClass(dir: "up" | "down" | "flat") {
  return dir === "up" ? "cmp-up" : dir === "down" ? "cmp-down" : "cmp-flat";
}
function cmpArrow(dir: "up" | "down" | "flat") {
  return dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
}
</script>

<template>
  <div class="psb">
    <!-- This-period label only shown in the expanded comparison view. -->
    <div v-if="detailed" class="psb-period-label">
      <span>This period</span>
      <span class="psb-period-total">{{ total }} total</span>
    </div>

    <!-- Current-period bar; empty track behind = unanswered remainder. -->
    <div class="psb-track">
      <span
        v-for="s in segments"
        :key="s.key"
        class="psb-seg"
        :style="{ width: pct(s.count) + '%', background: s.color }"
        :title="`${s.label}: ${s.count} (${pct(s.count)}%)`"
      />
    </div>

    <!-- Legend: one toggle per bucket. space-between puts the first segment
         hard-left and the last hard-right (negative ↔ none). -->
    <div class="psb-legend">
      <component
        :is="interactive ? 'button' : 'span'"
        v-for="s in segments"
        :key="s.key"
        :type="interactive ? 'button' : undefined"
        class="psb-item"
        :class="{ 'psb-item--open': s.open, 'psb-item--static': !interactive }"
        @click="interactive && $emit('toggle', s.key)"
      >
        <span :class="s.chipClass" class="psb-chip">{{ s.label }}</span>
        <span class="psb-pct">{{ pct(s.count) }}%</span>
        <span class="psb-count">{{ s.count }}</span>
        <!-- Compact inline delta — only in the simple (non-detailed) compare view. -->
        <span
          v-if="hasCompare && !detailed && s.compareCount != null"
          class="psb-cmp"
          :class="cmpClass(cmp(s).dir)"
          :title="`Compare period: ${s.compareCount} (${cmp(s).label})`"
        >{{ cmpArrow(cmp(s).dir) }} {{ cmp(s).label }}</span>
        <span v-if="interactive" class="psb-chev">{{ s.open ? "▲" : "▼" }}</span>
      </component>
    </div>

    <!-- Expanded comparison: a second (ghost) bar for the comparison period
         with its own stats repeated below, then a per-segment difference row. -->
    <template v-if="detailed">
      <div class="psb-period-label">
        <span>Comparison period</span>
        <span class="psb-period-total">{{ compareTotal }} total</span>
      </div>
      <div class="psb-track psb-track--ghost">
        <span
          v-for="s in segments"
          :key="'cmp-' + s.key"
          class="psb-seg"
          :style="{ width: comparePct(s) + '%', background: s.color }"
          :title="`${s.label}: ${s.compareCount ?? 0} (${comparePct(s)}%)`"
        />
      </div>
      <div class="psb-legend">
        <span
          v-for="s in segments"
          :key="'cmpleg-' + s.key"
          class="psb-item psb-item--static"
        >
          <span :class="s.chipClass" class="psb-chip">{{ s.label }}</span>
          <span class="psb-pct">{{ comparePct(s) }}%</span>
          <span class="psb-count">{{ s.compareCount ?? 0 }}</span>
        </span>
      </div>

      <!-- Difference (this − comparison): volume + share in percentage points. -->
      <div class="psb-legend psb-diff">
        <span
          v-for="s in segments"
          :key="'diff-' + s.key"
          class="psb-item psb-item--static"
        >
          <span class="psb-cmp" :class="cmpClass(diff(s).dir)">
            {{ cmpArrow(diff(s).dir) }} {{ diff(s).vol }} · {{ diff(s).pp }}
          </span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.psb {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

/* The 100% bar. */
.psb-track {
  display: flex;
  width: 100%;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}

.psb-seg {
  height: 100%;
  transition: width 0.25s ease;
}

/* Comparison-period bar — dimmed + dashed so the two periods read as distinct. */
.psb-track--ghost {
  opacity: 0.55;
  border: 1px dashed color-mix(in srgb, var(--ink) 20%, transparent);
  box-sizing: border-box;
}

/* Period heading above each bar in the expanded compare view. */
.psb-period-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-top: 2px;
}
.psb-period-total {
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

/* Difference row — separated from the period stats by a hairline. */
.psb-diff {
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

/* Legend row — equal-width slots so the chevrons line up regardless of
   how many segments there are. First slot hugs left, last hugs right. */
.psb-legend {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.psb-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  transition: background 0.15s;
}

/* Centre and right-hand items align toward their edge so labels track the bar. */
.psb-item:not(:first-child) {
  justify-content: flex-end;
}
.psb-item:only-child {
  justify-content: flex-start;
}

.psb-item:hover,
.psb-item--open {
  background: rgba(0, 0, 0, 0.05);
}

/* Display-only legend (e.g. competitor-identified) — no click affordance. */
.psb-item--static {
  cursor: default;
}
.psb-item--static:hover {
  background: none;
}

.psb-chip {
  font-size: 11px;
  white-space: nowrap;
}

.psb-pct {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
}

.psb-count {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink);
  white-space: nowrap;
}

.psb-cmp {
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.cmp-up { color: #16a34a; }
.cmp-down { color: #dc2626; }
.cmp-flat { color: #94a3b8; }

.psb-chev {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
</style>
