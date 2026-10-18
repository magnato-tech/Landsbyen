// The web client for Landsbyen: a phone-first page over the API. It knows nothing of how the
// village is stored; every list and every check comes from the API (api.ts).

import { addDays, dayIn, momentIn } from "../src/domain/days.ts";
import { KIND_INFO } from "../src/domain/torget.ts";
import type { Application, Message, PostKind, Role, User, Village } from "../src/domain/types.ts";
import type { PostView } from "../src/service.ts";
import type { Conversation, LandsbyApi, Me, MemberView, Preview } from "./api.ts";
import { KIND_ICONS } from "./icons.ts";

type Tab = "torget" | "samtaler" | "vert";

interface Thread {
  postId: string;
  postTitle: string;
  withId: string;
  withName: string;
}

interface State {
  me: Me | null;
  village: Village | null;
  role: Role | null;
  tab: Tab;
  kind: PostKind | null;
  tag: string | null;
  posts: PostView[];
  preview: Preview | null;
  conversations: Conversation[];
  applications: Application[];
  members: MemberView[];
  composing: PostKind | null;
  thread: Thread | null;
  threadMessages: Message[];
  confirmDelete: string | null;
  notice: { text: string; error: boolean } | null;
  busy: boolean;
}

export interface AppOptions {
  root: HTMLElement;
  api: LandsbyApi;
  villageId: string;
  /** The test people one can look as, in the demo and in development. Empty with real sign-in. */
  people: readonly User[];
  currentPerson: () => string;
  setPerson: (id: string) => void;
  /** A line under the switcher, e.g. that the demo starts over on reload. */
  demoNote?: string;
}

const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const firstName = (name: string) => name.split(" ")[0];

const ROLE_NAMES: Record<Role, string> = { vert: "landsbyvert", medlem: "medlem", landsbyboer: "landsbyboer" };
const ANSWERED_AS: Record<string, string> = { "blir-med": "Du blir med", "kan-hjelpe": "Du har sagt at du kan hjelpe", onsker: "Du har sagt ja takk" };
const KIND_ORDER: PostKind[] = ["invitasjon", "hjelp", "tilbud", "info"];
const FORM_TITLES: Record<PostKind, string> = {
  invitasjon: "Inviter til noe",
  hjelp: "Be om hjelp",
  tilbud: "Tilby hjelp",
  info: "Del noe med landsbyen",
};
const TITLE_HINTS: Record<PostKind, string> = {
  invitasjon: "For eksempel: Kaffe etter gudstjenesten",
  hjelp: "For eksempel: Trenger skyss til legen torsdag",
  tilbud: "For eksempel: Har tilhenger til utlån",
  info: "For eksempel: Funnet lue ved skolen",
};

export function startApp(options: AppOptions): void {
  const { root, api } = options;
  const state: State = {
    me: null,
    village: null,
    role: null,
    tab: "torget",
    kind: null,
    tag: null,
    posts: [],
    preview: null,
    conversations: [],
    applications: [],
    members: [],
    composing: null,
    thread: null,
    threadMessages: [],
    confirmDelete: null,
    notice: null,
    busy: false,
  };

  const tz = () => state.village?.timeZone ?? "Europe/Oslo";
  const today = () => dayIn(tz());

  function whenText(moment: string): string {
    const text = new Intl.DateTimeFormat("nb-NO", {
      timeZone: tz(),
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(moment));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function dayText(day: string): string {
    if (day === today()) return "i dag";
    if (day === addDays(today(), 1)) return "i morgen";
    return new Intl.DateTimeFormat("nb-NO", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
  }

  function agoText(moment: string): string {
    const minutes = Math.round((Date.now() - Date.parse(moment)) / 60_000);
    if (minutes < 60) return minutes <= 1 ? "nå nettopp" : `for ${minutes} minutter siden`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? "for en time siden" : `for ${hours} timer siden`;
    const days = Math.round(hours / 24);
    return days === 1 ? "i går" : `for ${days} dager siden`;
  }

  // ---------- Loading ----------

  async function attempt(work: () => Promise<void>, success?: string): Promise<void> {
    state.busy = true;
    try {
      await work();
      if (success) state.notice = { text: success, error: false };
    } catch (error) {
      state.notice = { text: error instanceof Error ? error.message : "Noe gikk galt.", error: true };
    } finally {
      state.busy = false;
      render();
    }
  }

  async function loadAll(): Promise<void> {
    state.village = await api.village();
    state.me = await api.me();
    state.role = state.me.memberships.find((m) => m.villageId === options.villageId)?.role ?? null;
    if (!state.role) {
      state.preview = await api.preview();
      state.applications = await api.applications();
      return;
    }
    if (state.tab === "vert" && state.role !== "vert") state.tab = "torget";
    await loadTab();
  }

  async function loadTab(): Promise<void> {
    if (state.tab === "torget") {
      state.posts = await api.posts({ kind: state.kind ?? undefined, tag: state.tag ?? undefined });
    }
    if (state.tab === "samtaler") state.conversations = await api.conversations();
    if (state.tab === "vert") {
      state.applications = await api.applications();
      state.members = await api.members();
    }
    if (state.role === "vert" && state.tab !== "vert") state.applications = await api.applications();
  }

  async function openThread(thread: Thread): Promise<void> {
    state.thread = thread;
    state.threadMessages = await api.messages(thread.postId, thread.withId);
  }

  // ---------- Drawing ----------

  function roofline(): string {
    // A row of houses with the church among them: the village and who runs it, at a glance
    return `<svg class="roofline" viewBox="0 0 360 64" role="img" aria-label="Hus og kirke i landsbyen">
      <g class="r-house">
        <path d="M6 64V36l20-16 20 16v28z"/><path d="M52 64V42l16-13 16 13v22z"/>
        <path d="M90 64V30l24-19 24 19v34z"/>
      </g>
      <g class="r-church">
        <path d="M150 64V34l22-18 22 18v30z"/><path d="M165 22V10h14v12l-7-6z"/><path d="M171 2h2v8h-2z"/><path d="M168 4h8v2h-8z"/>
      </g>
      <g class="r-house">
        <path d="M202 64V40l18-14 18 14v24z"/><path d="M244 64V32l22-17 22 17v32z"/>
        <path d="M294 64V44l15-12 15 12v20z"/><path d="M330 64V38l14-11 14 11v26z"/>
      </g>
      <g class="r-window"><rect x="22" y="44" width="8" height="8"/><rect x="108" y="40" width="10" height="9"/><rect x="168" y="44" width="8" height="12" rx="4"/><rect x="258" y="42" width="9" height="9"/></g>
    </svg>`;
  }

  function header(): string {
    const village = state.village;
    const person = options.people.find((p) => p.id === options.currentPerson());
    const switcher = options.people.length
      ? `<div class="switcher">
          <label for="person">Du ser landsbyen som</label>
          <select id="person" data-action="person">
            ${options.people
              .map((p) => `<option value="${esc(p.id)}" ${p.id === person?.id ? "selected" : ""}>${esc(p.name)}</option>`)
              .join("")}
          </select>
          ${options.demoNote ? `<p class="hint">${esc(options.demoNote)}</p>` : ""}
        </div>`
      : "";
    return `<header class="top">
      <div class="top-inner">
        ${roofline()}
        <div class="who">
          <h1>${esc(village?.name ?? "Landsbyen")}</h1>
          ${village ? `<p class="anchor">Drevet av <strong>${esc(village.anchor.name)}</strong></p>` : ""}
        </div>
        ${switcher}
      </div>
    </header>`;
  }

  function notice(): string {
    if (!state.notice) return "";
    return `<div class="notice ${state.notice.error ? "is-error" : ""}" role="status">
      <span>${esc(state.notice.text)}</span>
      <button type="button" class="link" data-action="dismiss" aria-label="Lukk meldingen">Lukk</button>
    </div>`;
  }

  function tabs(): string {
    const waiting = state.applications.filter((a) => a.status === "venter").length;
    const items: [Tab, string][] = [
      ["torget", "Torget"],
      ["samtaler", "Samtaler"],
    ];
    if (state.role === "vert") items.push(["vert", waiting ? `Søknader (${waiting})` : "Søknader"]);
    return `<nav class="tabs" aria-label="Landsbyen">${items
      .map(
        ([id, label]) =>
          `<button type="button" data-action="tab" data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${esc(label)}</button>`
      )
      .join("")}</nav>`;
  }

  function filters(): string {
    const kinds = [`<button type="button" class="chip ${!state.kind ? "is-on" : ""}" data-action="kind" data-kind="">Alt</button>`]
      .concat(
        KIND_ORDER.map(
          (kind) =>
            `<button type="button" class="chip kind-${kind} ${state.kind === kind ? "is-on" : ""}" data-action="kind" data-kind="${kind}">${KIND_ICONS[kind]}<span>${esc(KIND_INFO[kind].label)}</span></button>`
        )
      )
      .join("");
    const tag = state.tag
      ? `<p class="tag-filter">Viser innlegg merket <strong>#${esc(state.tag)}</strong> <button type="button" class="link" data-action="tag" data-tag="">Vis alle</button></p>`
      : "";
    return `<div class="filters" role="group" aria-label="Vis">${kinds}</div>${tag}`;
  }

  function composer(): string {
    const kind = state.composing;
    if (!kind) {
      return `<div class="compose-start">
        <p>Hva vil du ta opp med landsbyen?</p>
        <div class="compose-kinds">${KIND_ORDER.map(
          (k) => `<button type="button" class="kind-pick kind-${k}" data-action="compose" data-kind="${k}">${KIND_ICONS[k]}<span>${esc(FORM_TITLES[k])}</span></button>`
        ).join("")}</div>
      </div>`;
    }
    const invitation = kind === "invitasjon";
    return `<form class="composer kind-${kind}" data-form="post">
      <div class="composer-head">
        <h2>${KIND_ICONS[kind]}<span>${esc(FORM_TITLES[kind])}</span></h2>
        <button type="button" class="link" data-action="compose" data-kind="">Avbryt</button>
      </div>
      <label for="f-title">Overskrift</label>
      <input id="f-title" name="title" maxlength="80" required placeholder="${esc(TITLE_HINTS[kind])}">
      <label for="f-body">Fortell litt mer <span class="opt">valgfritt</span></label>
      <textarea id="f-body" name="body" maxlength="600" rows="3"></textarea>
      ${
        invitation
          ? `<div class="row">
              <div><label for="f-day">Dag</label><input id="f-day" name="day" type="date" min="${today()}" required></div>
              <div><label for="f-clock">Klokka</label><input id="f-clock" name="clock" type="time" value="18:00"></div>
            </div>`
          : ""
      }
      ${invitation || kind === "hjelp" ? `<label for="f-place">Sted <span class="opt">valgfritt</span></label><input id="f-place" name="place" maxlength="80">` : ""}
      <label for="f-tags">Stikkord <span class="opt">valgfritt, skill med mellomrom</span></label>
      <input id="f-tags" name="tags" placeholder="tur barn middag">
      ${
        invitation
          ? ""
          : `<label for="f-last">Står på torget til</label><input id="f-last" name="lastDay" type="date" min="${today()}" max="${addDays(today(), 90)}" value="${addDays(today(), 14)}">`
      }
      ${
        kind === "hjelp"
          ? `<label class="check" for="f-discreet"><input id="f-discreet" name="discreet" type="checkbox">
              <span>Spør diskret. Bare landsbyvertene ser forespørselen, og de tar kontakt med deg.</span></label>`
          : ""
      }
      <button type="submit" class="primary" ${state.busy ? "disabled" : ""}>Legg ut på torget</button>
    </form>`;
  }

  function postItem(post: PostView): string {
    const info = KIND_INFO[post.kind];
    const mayManage = post.mine || state.role === "vert";
    const when = post.when ? `<p class="when">${esc(whenText(post.when))}${post.place ? `<br>${esc(post.place)}` : ""}</p>` : post.place ? `<p class="when">${esc(post.place)}</p>` : "";
    const tags = post.tags.length
      ? `<p class="tags">${post.tags.map((t) => `<button type="button" class="tag" data-action="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join(" ")}</p>`
      : "";

    let actions = "";
    if (!post.mine && post.action && !post.myAnswer) {
      actions += `<button type="button" class="primary act kind-${post.kind}" data-action="answer" data-post="${post.id}">${esc(post.action)}</button>`;
    }
    if (!post.mine && post.myAnswer) {
      actions += `<p class="answered">${esc(ANSWERED_AS[post.myAnswer])}.</p>
        <button type="button" class="secondary" data-action="write" data-post="${post.id}" data-with="${esc(post.authorId)}" data-name="${esc(post.authorName)}">Skriv til ${esc(firstName(post.authorName))}</button>
        <button type="button" class="link" data-action="withdraw" data-post="${post.id}">Trekk svaret</button>`;
    }
    if (post.mine && post.responses.length) {
      actions += `<div class="responders">${post.responses
        .map(
          (r) =>
            `<button type="button" class="secondary" data-action="write" data-post="${post.id}" data-with="${esc(r.userId)}" data-name="${esc(r.name)}">Skriv til ${esc(firstName(r.name))}</button>`
        )
        .join("")}</div>`;
    }
    if (mayManage) {
      const confirming = state.confirmDelete === post.id;
      actions += `<div class="manage">
        <button type="button" class="link" data-action="close" data-post="${post.id}">${post.kind === "hjelp" ? "Hjelpen er gitt, avslutt" : "Avslutt"}</button>
        ${
          confirming
            ? `<span class="confirm">Slette for godt? <button type="button" class="link danger" data-action="delete" data-post="${post.id}">Ja, slett</button> <button type="button" class="link" data-action="nodelete">Nei</button></span>`
            : `<button type="button" class="link" data-action="askdelete" data-post="${post.id}">Slett</button>`
        }
      </div>`;
    }

    return `<article class="post kind-${post.kind}">
      <p class="kind">${KIND_ICONS[post.kind]}<span>${esc(info.label)}</span>${post.discreet ? '<span class="discreet">Diskret</span>' : ""}</p>
      <h3>${esc(post.title)}</h3>
      ${when}
      ${post.body ? `<p class="body">${esc(post.body)}</p>` : ""}
      ${tags}
      ${post.discreet ? `<p class="note">Bare ${post.mine ? "du og " : `${esc(firstName(post.authorName))} og `}landsbyvertene ser denne.</p>` : ""}
      <p class="by">${esc(post.mine ? "Lagt ut av deg" : `Lagt ut av ${post.authorName}`)} ${esc(agoText(post.createdAt))}. Står til ${esc(dayText(post.lastDay))}.</p>
      ${post.answersLine ? `<p class="answers">${esc(post.answersLine)}</p>` : ""}
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </article>`;
  }

  function torgetView(): string {
    const list = state.posts.length
      ? state.posts.map(postItem).join("")
      : `<p class="empty">${state.kind || state.tag ? "Ingen innlegg her akkurat nå. Prøv et annet filter, eller legg ut det første." : "Torget er tomt. Legg ut den første invitasjonen."}</p>`;
    return `${composer()}${filters()}<div class="posts">${list}</div>`;
  }

  function conversationsView(): string {
    if (!state.conversations.length) {
      return `<p class="empty">Her havner samtalene dine. Når du svarer på et innlegg, eller noen svarer på ditt, kan dere skrive til hverandre.</p>`;
    }
    return `<ul class="conversations">${state.conversations
      .map(
        (c) => `<li><button type="button" data-action="write" data-post="${esc(c.postId)}" data-with="${esc(c.withId)}" data-name="${esc(c.withName)}" data-title="${esc(c.postTitle)}">
          <strong>${esc(c.withName)}</strong>
          <span class="about">Om: ${esc(c.postTitle)}</span>
          <span class="last">${esc(c.lastText)}</span>
          <span class="ago">${esc(agoText(c.lastAt))}</span>
        </button></li>`
      )
      .join("")}</ul>`;
  }

  function hostView(): string {
    const waiting = state.applications.filter((a) => a.status === "venter");
    const applications = waiting.length
      ? waiting
          .map(
            (a) => `<article class="application">
          <h3>${esc(a.name)}</h3>
          <p class="meta">Søkte ${esc(agoText(a.appliedAt))}${a.area ? `. Bor: ${esc(a.area)}` : ""}</p>
          ${a.connection ? `<p class="body">${esc(a.connection)}</p>` : ""}
          <label for="w-${esc(a.id)}">Velkomsthilsen <span class="opt">valgfritt</span></label>
          <textarea id="w-${esc(a.id)}" rows="2" maxlength="500" placeholder="Velkommen til landsbyen, ${esc(firstName(a.name))}!"></textarea>
          <div class="actions">
            <button type="button" class="primary" data-action="approve" data-app="${esc(a.id)}" data-role="landsbyboer">Godkjenn som landsbyboer</button>
            <button type="button" class="secondary" data-action="approve" data-app="${esc(a.id)}" data-role="medlem">Godkjenn som medlem</button>
            <button type="button" class="link danger" data-action="reject" data-app="${esc(a.id)}">Avslå</button>
          </div>
        </article>`
          )
          .join("")
      : `<p class="empty">Ingen søknader venter. Nye søknader dukker opp her, og du får se dem med en gang.</p>`;
    const members = state.members
      .map((m) => `<li><span>${esc(m.name)}</span><span class="role role-${m.role}">${esc(ROLE_NAMES[m.role])}</span></li>`)
      .join("");
    return `<section aria-labelledby="h-apps"><h2 id="h-apps">Søknader som venter</h2>${applications}</section>
      <section aria-labelledby="h-members"><h2 id="h-members">I landsbyen (${state.members.length})</h2><ul class="members">${members}</ul></section>`;
  }

  function outsiderView(): string {
    const village = state.village!;
    const mine = state.applications.find((a) => a.status === "venter");
    const rejected = state.applications.find((a) => a.status === "avslatt");
    const preview = state.preview;
    const invitations = preview?.upcomingInvitations.length
      ? `<ul class="teaser">${preview.upcomingInvitations
          .map((i) => `<li><strong>${esc(i.title)}</strong>${i.when ? `<span>${esc(whenText(i.when))}</span>` : ""}</li>`)
          .join("")}</ul>`
      : "";
    const form = mine
      ? `<div class="waiting"><h2>Søknaden din er sendt</h2><p>En landsbyvert ser på den og gir deg beskjed. Det tar som regel under et døgn.</p></div>`
      : rejected
        ? `<div class="waiting"><h2>Søknaden ble ikke godkjent</h2><p>Ta gjerne kontakt med ${esc(village.anchor.name)} hvis du lurer på hvorfor.</p></div>`
        : `<form class="apply" data-form="apply">
            <h2>Søk om å bli med</h2>
            <label for="a-name">Navn</label>
            <input id="a-name" name="name" maxlength="80" required value="${esc(state.me?.name ?? "")}">
            <label for="a-area">Hvor bor du? <span class="opt">valgfritt</span></label>
            <input id="a-area" name="area" maxlength="80">
            <label for="a-conn">Hva er tilknytningen din til området? <span class="opt">valgfritt</span></label>
            <textarea id="a-conn" name="connection" maxlength="500" rows="2"></textarea>
            <label class="check" for="a-rules"><input id="a-rules" name="acceptedRules" type="checkbox" required><span>Jeg godtar levereglene</span></label>
            <button type="submit" class="primary" ${state.busy ? "disabled" : ""}>Send søknad</button>
          </form>`;
    return `<section class="intro">
        <p class="lead">${esc(village.description)}</p>
        ${preview ? `<p class="count">${preview.postsOnTorget} innlegg på torget nå. Dette skjer snart:</p>${invitations}` : ""}
        <h2>Levereglene</h2>
        <ul class="rules">${village.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </section>${form}`;
  }

  function threadView(): string {
    const thread = state.thread;
    if (!thread) return "";
    const me = state.me!.userId;
    const messages = state.threadMessages.length
      ? state.threadMessages
          .map(
            (m) => `<li class="${m.fromId === me ? "from-me" : ""}"><p>${esc(m.text)}</p><span>${esc(m.fromId === me ? "Du" : firstName(m.fromName))}, ${esc(agoText(m.at))}</span></li>`
          )
          .join("")
      : `<li class="first">Skriv det første ordet. Bare dere to ser samtalen.</li>`;
    return `<div class="thread-backdrop" data-action="closethread"></div>
      <section class="thread" role="dialog" aria-modal="true" aria-labelledby="h-thread">
        <div class="thread-head">
          <div><h2 id="h-thread">${esc(thread.withName)}</h2><p>Om: ${esc(thread.postTitle)}</p></div>
          <button type="button" class="link" data-action="closethread">Lukk</button>
        </div>
        <ul class="messages">${messages}</ul>
        <form class="say" data-form="message">
          <label for="m-text" class="sr">Melding til ${esc(firstName(thread.withName))}</label>
          <textarea id="m-text" name="text" rows="2" maxlength="500" required placeholder="Skriv til ${esc(firstName(thread.withName))}"></textarea>
          <button type="submit" class="primary">Send</button>
        </form>
      </section>`;
  }

  function render(): void {
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    let main = "";
    if (!state.village) main = `<p class="empty">Henter landsbyen …</p>`;
    else if (!state.role) main = outsiderView();
    else {
      const role = `<p class="you">Du er ${esc(ROLE_NAMES[state.role])} i landsbyen.</p>`;
      main = `${tabs()}${role}${state.tab === "torget" ? torgetView() : state.tab === "samtaler" ? conversationsView() : hostView()}`;
    }
    root.innerHTML = `${header()}<main class="page">${notice()}${main}</main>${threadView()}`;
    if (focusId) document.getElementById(focusId)?.focus();
    if (state.thread) {
      const list = root.querySelector(".messages");
      if (list) list.scrollTop = list.scrollHeight;
    }
  }

  // ---------- Acting ----------

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target || target.tagName === "SELECT") return;
    const { action, post, tab, kind, tag } = target.dataset;
    state.notice = action === "dismiss" ? null : state.notice;
    switch (action) {
      case "dismiss":
        return render();
      case "tab":
        state.tab = tab as Tab;
        state.composing = null;
        return void attempt(loadTab);
      case "kind":
        state.kind = (kind || null) as PostKind | null;
        return void attempt(loadTab);
      case "tag":
        state.tag = tag || null;
        state.tab = "torget";
        return void attempt(loadTab);
      case "compose":
        state.composing = (kind || null) as PostKind | null;
        render();
        if (state.composing) document.getElementById("f-title")?.focus();
        return;
      case "answer":
        return void attempt(async () => {
          const answered = await api.answer(post!);
          await loadTab();
          state.notice = { text: `${ANSWERED_AS[answered.myAnswer ?? ""] ?? "Svart"}. ${firstName(answered.authorName)} ser svaret ditt.`, error: false };
        });
      case "withdraw":
        return void attempt(async () => {
          await api.withdraw(post!);
          await loadTab();
        }, "Svaret er trukket.");
      case "close":
        return void attempt(async () => {
          await api.closePost(post!);
          await loadTab();
        }, "Innlegget er avsluttet og tatt av torget.");
      case "askdelete":
        state.confirmDelete = post!;
        return render();
      case "nodelete":
        state.confirmDelete = null;
        return render();
      case "delete":
        state.confirmDelete = null;
        return void attempt(async () => {
          await api.deletePost(post!);
          await loadTab();
        }, "Innlegget er slettet.");
      case "write": {
        const title = target.dataset.title ?? state.posts.find((p) => p.id === post)?.title ?? "";
        return void attempt(() => openThread({ postId: post!, postTitle: title, withId: target.dataset.with!, withName: target.dataset.name! }));
      }
      case "closethread":
        state.thread = null;
        return void attempt(loadTab);
      case "approve": {
        const id = target.dataset.app!;
        const welcome = (document.getElementById(`w-${id}`) as HTMLTextAreaElement | null)?.value.trim();
        const role = target.dataset.role as "landsbyboer" | "medlem";
        return void attempt(async () => {
          const member = await api.approve(id, welcome ? { role, welcome } : { role });
          await loadTab();
          state.notice = { text: `${member.name} er godkjent som ${ROLE_NAMES[member.role]}.`, error: false };
        });
      }
      case "reject":
        return void attempt(async () => {
          await api.reject(target.dataset.app!);
          await loadTab();
        }, "Søknaden er avslått.");
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.action === "person") {
      options.setPerson((target as HTMLSelectElement).value);
      state.thread = null;
      state.composing = null;
      state.notice = null;
      state.tab = "torget";
      void attempt(loadAll);
    }
  });

  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();

    if (form.dataset.form === "post" && state.composing) {
      const kind = state.composing;
      const input: Record<string, unknown> = {
        kind,
        title: text("title"),
        body: text("body"),
        tags: text("tags") ? [text("tags")] : [],
        place: text("place") || undefined,
        discreet: data.get("discreet") === "on",
      };
      if (kind === "invitasjon" && text("day")) input.when = momentIn(text("day"), text("clock") || "11:00", tz());
      if (kind !== "invitasjon" && text("lastDay")) input.lastDay = text("lastDay");
      return void attempt(async () => {
        await api.createPost(input);
        state.composing = null;
        state.kind = null;
        state.tag = null;
        await loadTab();
      }, input.discreet ? "Forespørselen er sendt diskret til landsbyvertene." : "Innlegget står på torget.");
    }

    if (form.dataset.form === "message" && state.thread) {
      const thread = state.thread;
      return void attempt(async () => {
        await api.sendMessage(thread.postId, thread.withId, text("text"));
        state.threadMessages = await api.messages(thread.postId, thread.withId);
      });
    }

    if (form.dataset.form === "apply") {
      return void attempt(async () => {
        await api.apply({
          name: text("name"),
          area: text("area") || undefined,
          connection: text("connection") || undefined,
          acceptedRules: data.get("acceptedRules") === "on",
        });
        state.applications = await api.applications();
      }, "Søknaden er sendt.");
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.thread) {
      state.thread = null;
      void attempt(loadTab);
    }
  });

  render();
  void attempt(loadAll);
}
