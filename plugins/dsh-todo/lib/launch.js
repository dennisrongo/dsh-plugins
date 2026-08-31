// src/launch.ts
function composePrompt(item) {
  const parts = [`# ${item.title}`];
  const description = item.description?.trim();
  if (description) parts.push(description);
  const context = [];
  if (item.priority) context.push(`Priority: ${item.priority.toUpperCase()}`);
  if (item.release) context.push(`Release: ${item.release}`);
  if (item.sprint) context.push(`Sprint: ${item.sprint}`);
  if (item.dueDate) context.push(`Due: ${item.dueDate}`);
  if (context.length > 0) parts.push(context.join(" \xB7 "));
  return parts.join("\n\n");
}
var MAX_SESSION_TITLE = 80;
function sessionTitleFor(item) {
  const normalized = item.title.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return void 0;
  if (normalized.length <= MAX_SESSION_TITLE) return normalized;
  const clipped = normalized.slice(0, MAX_SESSION_TITLE);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > MAX_SESSION_TITLE - 20 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}\u2026`;
}
function flattenModels(groups) {
  const out = [];
  for (const group of groups) {
    const provider = group.id;
    if (provider === void 0) continue;
    const heading = group.name ?? "";
    for (const model of group.models ?? []) {
      const id = model.id;
      if (id === void 0) continue;
      out.push({
        provider,
        model: id,
        label: model.name ?? id,
        group: heading
      });
    }
  }
  return out;
}
var BUILT_IN_PRESET_NAME_KEYS = {
  standard: "presetStandardName",
  ptc: "presetPtcName",
  minimal: "presetMinimalName",
  cordis: "presetCordisName"
};
function presetOptions(presets, t) {
  const healthy = presets.filter((preset) => preset.broken === void 0);
  const options = healthy.map((preset) => {
    const key = preset.trust === "system" ? BUILT_IN_PRESET_NAME_KEYS[preset.id] : void 0;
    const translated = key !== void 0 && t !== void 0 ? t(key) : void 0;
    const localized = translated !== void 0 && translated !== key ? translated : void 0;
    return {
      id: preset.id,
      label: localized ?? preset.label ?? preset.name ?? preset.title ?? preset.id
    };
  });
  const defaultId = healthy.find((preset) => preset.isDefault)?.id ?? healthy[0]?.id;
  return { options, defaultId };
}
async function launchSession(ctx, request) {
  const { sessionId, presetId, model, prompt, title } = request;
  if (presetId !== void 0 && ctx.remote.agentPresets !== void 0) {
    let applied;
    try {
      applied = await ctx.remote.agentPresets.select(sessionId, presetId);
    } catch (cause) {
      throw new Error(`could not set mode: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!applied.ok) {
      throw new Error(`could not set mode: ${applied.error.message}`);
    }
  }
  if (model !== void 0 && ctx.modelDirectories !== void 0) {
    const directory = ctx.modelDirectories.directoryFor(sessionId);
    if (directory !== void 0) await directory.select(model);
  }
  const binding = ctx.sessions.binding(sessionId);
  if (binding === void 0) {
    throw new Error("the new session is not addressable yet");
  }
  const sent = await binding.session.prompt([{ type: "text", text: prompt }], "queue");
  if (!sent.ok) {
    throw new Error(`could not send the prompt: ${sent.error?.message ?? "unknown error"}`);
  }
  if (title !== void 0 && typeof binding.session.rename === "function") {
    try {
      await binding.session.rename(title);
    } catch {
    }
  }
  ctx.sessions.open(sessionId);
  return sessionId;
}
async function discardSession(ctx, sessionId) {
  try {
    await ctx.uiWorkspace?.archiveSession(sessionId);
  } catch {
  }
}
export {
  composePrompt,
  discardSession,
  flattenModels,
  launchSession,
  presetOptions,
  sessionTitleFor
};
