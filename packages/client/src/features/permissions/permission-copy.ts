/**
 * Claude-flavored presentation of the permission presets, keyed by preset
 * id. The host's catalog decides WHICH presets a deployment offers — a
 * third-party plugin's ride in it, the auto mode plugin's `auto-mode` among
 * them — and this table decides how a known one reads. A preset the table
 * does not know falls back to the name the catalog carries, so nothing the
 * host offers is ever hidden and a machine id is never shown.
 */
export const PERMISSION_PRESETS: Record<string, { label: string, desc: string }> = {
  'read-only': { label: 'Plan', desc: 'Read and explore without changing files.' },
  'workspace-write': { label: 'Accept edits', desc: 'Allow edits within the workspace.' },
  'auto-mode': { label: 'Auto', desc: 'Routine actions are allowed; a classifier reviews the rest.' },
  'auto': { label: 'Auto review', desc: 'Runs without a sandbox; the model reviews each call.' },
  'danger-full-access': { label: 'Bypass permissions', desc: 'Run without permission prompts.' },
  'full-access-ask': { label: 'Yolo (browser)', desc: 'Full file access; browser actions run without prompts.' }
}

/**
 * The control's segments, in slot order. Each slot lists the presets it may
 * bind to, best first: the deployment's own auto tier wins the slot over the
 * host's built-in Auto review, and a slot none of whose presets the host
 * offers is not drawn at all.
 */
export const PERMISSION_SEGMENTS = [
  { label: 'Plan', presets: ['read-only'] },
  { label: 'Accept edits', presets: ['workspace-write'] },
  { label: 'Auto', presets: ['auto-mode', 'auto'] },
  { label: 'Bypass permissions', presets: ['danger-full-access'] },
  { label: 'Yolo (browser)', presets: ['full-access-ask'] }
]

/** Popover row order; a preset the host offers but this list does not know follows in catalog order. */
export const PERMISSION_ORDER = ['read-only', 'workspace-write', 'auto-mode', 'auto', 'danger-full-access', 'full-access-ask']

/**
 * What the control draws before the host's first catalog read settles: the
 * shipped built-ins, with the auto slot left out the way the shipped picker
 * renders nothing until its own catalog arrives.
 */
export const PERMISSION_SHIPPED_PRESETS = ['read-only', 'workspace-write', 'danger-full-access']

/**
 * Names for host values that are never switch targets. `custom` is the
 * host's own word for knob settings that match no preset, so the trigger
 * reads that rather than the machine value.
 */
export const PERMISSION_CURRENT_LABELS: Record<string, string> = { custom: 'Custom' }

/** Skin-owned class names, so nothing couples to hashed CSS-module classes. */
export const SEGMENTS_CLASS = 'dsh-claude-segments'
export const SEGMENT_CLASS = 'dsh-claude-segment'
