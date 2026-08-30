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
function flattenModels(groups) {
  const out = [];
  for (const group of groups) {
    const heading = group.label ?? group.title ?? group.name ?? "";
    for (const model of group.models ?? group.items ?? []) {
      const id = model.model ?? model.id;
      const provider = model.provider;
      if (id === void 0 || provider === void 0) continue;
      out.push({
        provider,
        model: id,
        label: model.label ?? model.displayName ?? model.name ?? id,
        group: heading
      });
    }
  }
  return out;
}
function presetOptions(presets) {
  const healthy = presets.filter((preset) => preset.broken === void 0);
  const options = healthy.map((preset) => ({
    id: preset.id,
    label: preset.label ?? preset.name ?? preset.title ?? preset.id
  }));
  const defaultId = healthy.find((preset) => preset.isDefault)?.id ?? healthy[0]?.id;
  return { options, defaultId };
}
async function launchSession(ctx, request) {
  const { sessionId, presetId, model, prompt } = request;
  if (presetId !== void 0 && ctx.remote.agentPresets !== void 0) {
    const applied = await ctx.remote.agentPresets.select(sessionId, presetId);
    if (!applied.ok) {
      throw new Error(`could not set mode: ${applied.error.message}`);
    }
  }
  if (model !== void 0 && ctx.modelDirectories !== void 0) {
    await ctx.modelDirectories.directoryFor(sessionId).select(model);
  }
  const binding = ctx.sessions.binding(sessionId);
  if (binding === void 0) {
    throw new Error("the new session is not addressable yet");
  }
  const sent = await binding.session.prompt([{ type: "text", text: prompt }], "queue");
  if (!sent.ok) {
    throw new Error(`could not send the prompt: ${sent.error?.message ?? "unknown error"}`);
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
  presetOptions
};
