import type { AIAgent, AgentTask, CollaborationMode, RouteResult } from "../../shared/types";

export type ManualAgentTask = {
  agent: AIAgent;
  task: string;
};

export type CollaborationDetection =
  | { mode: "manual"; tasks: ManualAgentTask[] }
  | { mode: "mention"; targetAgent: AIAgent; task: string }
  | { mode: "coordinator"; primaryAgent: AIAgent; task: string }
  | { mode: "normal" };

function extractMentions(message: string): string[] {
  const mentions: string[] = [];
  const regex = /@([^\s@，,。；;：:]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message)) !== null) {
    mentions.push(cleanName(match[1]));
  }
  return mentions.filter(Boolean);
}

function cleanName(value: string) {
  return value.trim().replace(/[，,。；;：:]+$/g, "");
}

function findAgentByName(name: string, agents: AIAgent[]) {
  const clean = cleanName(name);
  const lower = clean.toLowerCase();
  return (
    agents.find((agent) => agent.enabled === 1 && agent.name === clean) ??
    agents.find((agent) => agent.enabled === 1 && agent.name.toLowerCase() === lower) ??
    agents.find((agent) => agent.enabled === 1 && (agent.name.includes(clean) || clean.includes(agent.name)))
  );
}

function uniqueTasks(tasks: ManualAgentTask[]) {
  const seen = new Set<string>();
  const result: ManualAgentTask[] = [];
  for (const item of tasks) {
    const key = `${item.agent.id}:${item.task}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function detectMultiTask(message: string, agents: AIAgent[]): { mode: "manual"; tasks: ManualAgentTask[] } | null {
  const tasks: ManualAgentTask[] = [];
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^@([^\s@，,。；;：:]+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const agent = findAgentByName(match[1], agents);
    const task = match[2].trim();
    if (agent && task) {
      tasks.push({ agent, task });
    }
  }

  if (tasks.length >= 2) {
    return { mode: "manual", tasks: uniqueTasks(tasks) };
  }

  const manualPatterns = [
    /让\s*([^，,。；;\n]+?)\s*(做|负责|执行|处理|分析|优化|审查|检查|写)\s*([^，,。；;\n]+)/g,
    /([^，,。；;\n\s]+?)\s*(负责|执行|处理|分析|优化|审查|检查|写)\s*[:：]?\s*([^，,。；;\n]+)/g,
  ];

  for (const pattern of manualPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      const agent = findAgentByName(match[1], agents);
      const task = `${match[2]}${match[3]}`.trim();
      if (agent && task) {
        tasks.push({ agent, task });
      }
    }
  }

  const unique = uniqueTasks(tasks);
  return unique.length >= 2 ? { mode: "manual", tasks: unique } : null;
}

export function detectCoordinatorNeed(message: string): boolean {
  const keywords = [
    "帮我协调",
    "你来协调",
    "你来分配",
    "帮我分配",
    "分配给合适",
    "合适AI处理",
    "合适的AI处理",
    "协调一下",
    "组织一下",
    "安排一下",
    "统筹一下",
  ];
  const lower = message.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function isManualMode(message: string): boolean {
  return /让\s*\S+\s*(做|负责|执行|处理|分析|优化|审查|检查|写)/.test(message);
}

export function routeCollaboration(message: string, agents: AIAgent[]): RouteResult {
  const manual = detectMultiTask(message, agents);
  if (manual) {
    return buildRoute(
      "manual",
      manual.tasks.map((task) => task.agent),
      manual.tasks.map((task) => ({ agentId: task.agent.id, agentName: task.agent.name, task: task.task })),
    );
  }

  const mentions = extractMentions(message);
  if (mentions.length > 0) {
    const targets = mentions.map((name) => findAgentByName(name, agents)).filter((agent): agent is AIAgent => Boolean(agent));
    if (targets.length > 0) {
      const taskText = removeMentionTokens(message, targets).trim() || message;
      const tasks: AgentTask[] = targets.map((agent) => ({ agentId: agent.id, agentName: agent.name, task: taskText }));
      return buildRoute("mention", targets, tasks);
    }
  }

  if (detectCoordinatorNeed(message)) {
    const primary = agents.find((agent) => agent.isPrimary === 1) || agents[0];
    return buildRoute("coordinator", primary ? [primary] : [], [
      { agentId: primary?.id || "", agentName: primary?.name || "主AI", task: message },
    ]);
  }

  const primary = agents.find((agent) => agent.isPrimary === 1) || agents[0];
  return buildRoute("normal", primary ? [primary] : [], [
    { agentId: primary?.id || "", agentName: primary?.name || "AI", task: message },
  ]);
}

export function detectCollaborationMode(message: string, agents: AIAgent[]): CollaborationDetection {
  const manual = detectMultiTask(message, agents);
  if (manual) {
    return manual;
  }

  const mentions = extractMentions(message);
  if (mentions.length) {
    const targetAgent = mentions.map((name) => findAgentByName(name, agents)).find((agent): agent is AIAgent => Boolean(agent));
    if (targetAgent) {
      return {
        mode: "mention",
        targetAgent,
        task: removeMentionTokens(message, [targetAgent]).trim() || message,
      };
    }
  }

  if (detectCoordinatorNeed(message)) {
    const primaryAgent = agents.find((agent) => agent.enabled === 1 && agent.isPrimary === 1) ?? agents.find((agent) => agent.enabled === 1);
    if (primaryAgent) {
      return { mode: "coordinator", primaryAgent, task: message };
    }
  }

  return { mode: "normal" };
}

function removeMentionTokens(message: string, agents: AIAgent[]) {
  let next = message;
  for (const agent of agents) {
    next = next.replace(new RegExp(`@${escapeRegExp(agent.name)}\\b`, "g"), "");
  }
  return next.replace(/@[^\s@，,。；;：:]+/g, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRoute(mode: CollaborationMode, targets: AIAgent[], tasks: AgentTask[]): RouteResult {
  return { mode, targets, tasks };
}

export const agentRouterInternals = {
  extractMentions,
  detectCoordinatorNeed,
  isManualMode,
};