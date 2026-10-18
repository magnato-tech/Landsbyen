// The symbols of the four kinds of posts, drawn for Landsbyen: things from a village rather than
// from an app. Each is a 24×24 line drawing in the colour of the text around it, so it takes the
// kind's colour wherever it stands (label, filter, the buttons that start a post).
//
//   invitasjon  an envelope: an invitation, and the five things one can be invited to (CATEGORY_ICONS)
//   hjelp       a raised hand: asking for help
//   tilbud      a basket: bringing something
//   info        the notice board on the square

import type { InvitationCategory, PostKind } from "../src/domain/types.ts";

const draw = (paths: string) =>
  `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

const ENVELOPE = draw(
  '<rect x="2.5" y="5" width="19" height="14" rx="1.5"/>' +
    '<path d="M3.2 6.2L12 13l8.8-6.8"/>' +
    '<path d="M3.2 18l6.3-6.6"/><path d="M20.8 18l-6.3-6.6"/>'
);

/** What an invitation is to, each with its own thing from village life. */
export const CATEGORY_ICONS: Record<InvitationCategory, string> = {
  // Two ridges and the sun: out on a walk
  tur: draw('<path d="M2 20l6.5-11 4 6.5 3-4.5L22 20z"/><circle cx="17.5" cy="5.5" r="2"/>'),
  // A cup of coffee: being asked in
  mat: draw(
    '<path d="M5 10h11v3.5a5.5 5.5 0 0 1-5.5 5.5h0A5.5 5.5 0 0 1 5 13.5z"/>' +
      '<path d="M16 11.5h1.5a2.5 2.5 0 0 1 0 5H16"/>' +
      '<path d="M3 21.5h15"/>' +
      '<path d="M8.5 2.5c-1 1.2 1 2.3 0 3.5"/><path d="M12.5 2.5c-1 1.2 1 2.3 0 3.5"/>'
  ),
  // A ball: playing something together
  aktivitet: draw(
    '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M12 7.5l4 2.9-1.5 4.7h-5L8 10.4z"/>' +
      '<path d="M12 7.5V3"/><path d="M16 10.4l4.3-1.4"/><path d="M14.5 15.1l2.7 3.7"/><path d="M9.5 15.1l-2.7 3.7"/><path d="M8 10.4L3.7 9"/>'
  ),
  // Three people side by side: gathering
  samling: draw(
    '<circle cx="12" cy="7" r="2.6"/><circle cx="5.5" cy="9" r="2.1"/><circle cx="18.5" cy="9" r="2.1"/>' +
      '<path d="M7 20v-2.5a5 5 0 0 1 10 0V20"/>' +
      '<path d="M2 19v-1.5a3.6 3.6 0 0 1 5.2-3.2"/><path d="M22 19v-1.5a3.6 3.6 0 0 0-5.2-3.2"/>'
  ),
  annet: ENVELOPE,
};

export const KIND_ICONS: Record<PostKind, string> = {
  invitasjon: ENVELOPE,
  hjelp: draw(
    '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11"/>' +
      '<path d="M11 10.5v-6a1.5 1.5 0 0 1 3 0v6"/>' +
      '<path d="M14 10.5v-5a1.5 1.5 0 0 1 3 0V12"/>' +
      '<path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a6.5 6.5 0 0 1-5-2.4l-3.3-4a1.6 1.6 0 0 1 2.4-2.1L8 15.5V13"/>'
  ),
  tilbud: draw(
    '<path d="M7 10a5 5 0 0 1 10 0"/>' +
      '<path d="M2.5 10h19"/>' +
      '<path d="M4.5 10l1.6 9.3a2 2 0 0 0 2 1.7h7.8a2 2 0 0 0 2-1.7l1.6-9.3"/>' +
      '<path d="M9.5 13.5v4"/><path d="M14.5 13.5v4"/>'
  ),
  info: draw(
    '<rect x="2.5" y="3.5" width="19" height="13" rx="1.5"/>' +
      '<path d="M7 16.5v5"/><path d="M17 16.5v5"/>' +
      '<rect x="6" y="7" width="6" height="6" rx="0.5"/>' +
      '<circle cx="9" cy="7" r="1" fill="currentColor" stroke="none"/>' +
      '<path d="M15 8h3"/><path d="M15 11h3"/>'
  ),
};
