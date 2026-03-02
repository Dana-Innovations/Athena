import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  CortexSkillDetailResponse,
  CortexSkillSummary,
  CortexSkillsListResult,
  SkillStatusReport,
} from "../types.ts";

export type SkillsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  skillsError: string | null;
  skillsBusyKey: string | null;
  skillEdits: Record<string, string>;
  skillMessages: SkillMessageMap;
  cortexSkills: CortexSkillSummary[];
  cortexSkillsError: string | null;
  cortexSkillDetail: CortexSkillDetailResponse | null;
  cortexSkillDetailName: string | null;
};

export type SkillMessage = {
  kind: "success" | "error";
  message: string;
};

export type SkillMessageMap = Record<string, SkillMessage>;

type LoadSkillsOptions = {
  clearMessages?: boolean;
};

function setSkillMessage(state: SkillsState, key: string, message?: SkillMessage) {
  if (!key.trim()) {
    return;
  }
  const next = { ...state.skillMessages };
  if (message) {
    next[key] = message;
  } else {
    delete next[key];
  }
  state.skillMessages = next;
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export async function loadSkills(state: SkillsState, options?: LoadSkillsOptions) {
  if (options?.clearMessages && Object.keys(state.skillMessages).length > 0) {
    state.skillMessages = {};
  }
  if (!state.client || !state.connected) {
    return;
  }
  if (state.skillsLoading) {
    return;
  }
  state.skillsLoading = true;
  state.skillsError = null;
  state.cortexSkillsError = null;
  try {
    const [localRes, cortexRes] = await Promise.allSettled([
      state.client.request<SkillStatusReport | undefined>("skills.status", {}),
      state.client.request<CortexSkillsListResult>("sonance.skills.list", {}),
    ]);
    if (localRes.status === "fulfilled" && localRes.value) {
      state.skillsReport = localRes.value;
    } else if (localRes.status === "rejected") {
      state.skillsError = getErrorMessage(localRes.reason);
    }
    if (cortexRes.status === "fulfilled" && cortexRes.value?.skills) {
      state.cortexSkills = cortexRes.value.skills;
    } else if (cortexRes.status === "rejected") {
      state.cortexSkillsError = getErrorMessage(cortexRes.reason);
    }
  } catch (err) {
    state.skillsError = getErrorMessage(err);
  } finally {
    state.skillsLoading = false;
  }
}

export function updateSkillEdit(state: SkillsState, skillKey: string, value: string) {
  state.skillEdits = { ...state.skillEdits, [skillKey]: value };
}

export async function updateSkillEnabled(state: SkillsState, skillKey: string, enabled: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    await state.client.request("skills.update", { skillKey, enabled });
    await loadSkills(state);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: enabled ? "Skill enabled" : "Skill disabled",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function saveSkillApiKey(state: SkillsState, skillKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    const apiKey = state.skillEdits[skillKey] ?? "";
    await state.client.request("skills.update", { skillKey, apiKey });
    await loadSkills(state);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: "API key saved",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function installSkill(
  state: SkillsState,
  skillKey: string,
  name: string,
  installId: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    const result = await state.client.request<{ message?: string }>("skills.install", {
      name,
      installId,
      timeoutMs: 120000,
    });
    await loadSkills(state);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: result?.message ?? "Installed",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

// ── Cortex Skills ───────────────────────────────────────────────────

export async function toggleCortexSkill(state: SkillsState, skillName: string, enabled: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  const key = `cortex:${skillName}`;
  state.skillsBusyKey = key;
  try {
    await state.client.request("sonance.skills.update_settings", {
      skillName,
      enabled,
    });
    // Reload Cortex skills to reflect the updated state
    const res = await state.client.request<CortexSkillsListResult>("sonance.skills.list", {});
    if (res?.skills) {
      state.cortexSkills = res.skills;
    }
    setSkillMessage(state, key, {
      kind: "success",
      message: enabled ? "Skill enabled" : "Skill disabled",
    });
  } catch (err) {
    setSkillMessage(state, key, {
      kind: "error",
      message: getErrorMessage(err),
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function loadCortexSkillDetail(state: SkillsState, skillName: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.cortexSkillDetailName = skillName;
  state.cortexSkillDetail = null;
  try {
    const res = await state.client.request<CortexSkillDetailResponse>("sonance.skills.detail", {
      skillName,
    });
    if (res) {
      state.cortexSkillDetail = res;
    }
  } catch (err) {
    setSkillMessage(state, `cortex:${skillName}`, {
      kind: "error",
      message: getErrorMessage(err),
    });
  }
}
