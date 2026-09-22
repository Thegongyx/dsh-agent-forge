/**
 * The page's stylesheet.
 *
 * Shipped as one CSS string and installed once through a `<style>` element
 * rather than as CSS Modules: the harness's CSS Modules pipeline lives inside
 * its own build preset, which cannot build a package outside the checkout, and
 * a page-sized stylesheet does not justify reproducing that pipeline here.
 *
 * Colours come only from the shell's `--dsw-*` tokens. The fallbacks are for a
 * theme that has not published a token yet; a literal colour would ignore the
 * user's theme entirely.
 *
 * @module dsh-agent-forge/client/styles
 */

/** Attribute marking this plugin's style element, so a re-apply cannot duplicate it. */
const STYLE_ATTRIBUTE = 'data-plugin-css'

/** Identifies this plugin's single style element. */
const STYLE_ID = 'dsh-agent-forge/page.css'

export const PAGE_CSS = `
.dsh-af{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328)}
.dsh-af__title{font-size:15px;font-weight:600;margin:0}
.dsh-af__subtitle{margin:0;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-af__banner{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:6px;padding:8px 10px;color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02))}
.dsh-af__tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.dsh-af__tab{border:none;background:none;font:inherit;padding:7px 12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280);border-bottom:2px solid transparent;white-space:nowrap}
.dsh-af__tab[aria-selected="true"]{color:var(--dsw-alias-brand-primary,#4f6ef7);border-bottom-color:var(--dsw-alias-brand-primary,#4f6ef7);font-weight:600}
.dsh-af__split{display:flex;gap:16px;align-items:flex-start}
.dsh-af__list{flex:0 0 220px;display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-af__listItem{display:flex;flex-direction:column;gap:2px;text-align:left;border:1px solid transparent;background:none;font:inherit;padding:7px 9px;border-radius:6px;cursor:pointer;color:inherit}
.dsh-af__listItem:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03))}
.dsh-af__listItem[aria-current="true"]{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));border-color:var(--dsw-alias-border-l2,#e5e7eb)}
.dsh-af__listName{font-weight:600}
.dsh-af__meta{font-size:11px;color:var(--dsw-alias-label-dimmed,#8b949e)}
.dsh-af__editor{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:12px}
.dsh-af__field{display:flex;flex-direction:column;gap:4px}
.dsh-af__fieldLabel{font-weight:600;font-size:12px}
.dsh-af__hint{font-size:11px;color:var(--dsw-alias-label-dimmed,#8b949e)}
.dsh-af__input,.dsh-af__area,.dsh-af__num{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:6px;padding:6px 8px;width:100%;box-sizing:border-box}
.dsh-af__area{min-height:110px;resize:vertical;font-family:inherit;line-height:1.5}
.dsh-af__area--tall{min-height:220px}
.dsh-af__num{max-width:120px}
.dsh-af__row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.dsh-af__actions{display:flex;gap:8px;align-items:center}
.dsh-af__button{font:inherit;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02));color:inherit;border-radius:6px;padding:5px 10px;cursor:pointer}
.dsh-af__button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05))}
.dsh-af__button:disabled{opacity:.5;cursor:default}
.dsh-af__button--danger{color:var(--dsw-alias-label-error,#d1242f)}
.dsh-af__checks{display:flex;flex-wrap:wrap;gap:4px 14px}
.dsh-af__checks--tall{flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2,#30363d);border-radius:6px}
.dsh-af__listFlat{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:160px;overflow-y:auto}
.dsh-af__group{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.dsh-af__groupHead{font-weight:600;font-size:12px;margin-bottom:2px}
.dsh-af__details{margin-left:20px}
.dsh-af__details>summary{cursor:pointer;font-size:11px;color:var(--dsw-alias-label-dimmed,#8b949e);margin-bottom:2px}
.dsh-af__meta--wrap{white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dsh-af__check{display:flex;align-items:center;gap:6px;cursor:pointer}
.dsh-af__button[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-brand-primary,#4f6ef7);font-weight:600}
.dsh-af__empty{color:var(--dsw-alias-label-dimmed,#8b949e);padding:12px 0}
.dsh-af-map{display:flex;flex-direction:column;gap:14px;padding:16px;color:var(--dsw-alias-label-primary,#1f2328)}
.dsh-af-map__head{margin:0}
.dsh-af-map__title{font-size:15px;font-weight:600;margin:0}
.dsh-af-map__subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-af-map__empty{color:var(--dsw-alias-label-dimmed,#8b949e);font-size:13px;line-height:1.6;max-width:52ch}
.dsh-af-map__split{display:flex;gap:16px;align-items:flex-start;min-height:0}
.dsh-af-map__canvas{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:14px}
.dsh-af-map__lane{display:flex;flex-direction:column;gap:6px}
.dsh-af-map__laneTitle{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;margin:0;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-af-map__laneCount{font-weight:400;color:var(--dsw-alias-label-dimmed,#8b949e)}
.dsh-af-map__cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.dsh-af-map__card{display:flex;flex-direction:column;gap:6px;text-align:left;font:inherit;color:inherit;cursor:pointer;padding:9px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02))}
.dsh-af-map__card[data-state="running"]{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.dsh-af-map__card[aria-current="true"]{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4f6ef7)}
.dsh-af-map__cardTask{font-size:13px;line-height:1.45;word-break:break-word}
.dsh-af-map__cardMeta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--dsw-alias-label-dimmed,#8b949e)}
.dsh-af-map__state{display:inline-flex;align-items:center;gap:4px;font-weight:600}
.dsh-af-map__state::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#8b949e)}
.dsh-af-map__state[data-state="running"]::before{background:var(--dsw-alias-brand-primary,#4f6ef7)}
.dsh-af-map__detail{flex:0 0 260px;display:flex;flex-direction:column;gap:10px;border-left:1px solid var(--dsw-alias-border-l2,#e5e7eb);padding-left:16px}
.dsh-af-map__taskText{margin:0;font-size:13px;line-height:1.5;word-break:break-word}
.dsh-af-map__facts{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:12px}
.dsh-af-map__facts dt{color:var(--dsw-alias-label-dimmed,#8b949e)}
.dsh-af-map__facts dd{margin:0;word-break:break-all}
.dsh-af-map__id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
`.trim()

/**
 * Installs the page stylesheet once.
 * @returns the disposer removing the element this call created, or nothing when one already stood.
 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[${STYLE_ATTRIBUTE}="${STYLE_ID}"]`)
  if (existing !== null) return () => {}

  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ATTRIBUTE, STYLE_ID)
  tag.textContent = PAGE_CSS
  document.head.append(tag)
  return () => { tag.remove() }
}
