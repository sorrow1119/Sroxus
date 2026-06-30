import type { AIAgent, AgentResult } from "../../shared/types";
import { runAgent, runMultipleAgents } from "./agent-runner";
import type { ManualAgentTask } from "./agent-router";

type CoordinationUpdate = {
  stage: "planning" | "plan" | "collecting" | "summarizing";
  content: string;
};

type HandleCoordinatingOptions = {
  signal: AbortSignal;
  parentMessageId?: string;
  onStatus?: (update: CoordinationUpdate) => void;
  onFinalDelta?: (delta: string) => void;
};

type Assignment = {
  agent: string;
  task: string;
};

export async function handleCoordinating(
  conversationId: string,
  userMessage: string,
  agents: AIAgent[],
  options: HandleCoordinatingOptions,
): Promise<string> {
  const primaryAgent = agents.find((agent) => agent.enabled === 1 && agent.isPrimary === 1) ?? agents.find((agent) => agent.enabled === 1);
  if (!primaryAgent) {
    throw new Error("没有可用的主AI，请先在 AI 列表里启用一个主AI。");
  }

  const workerAgents = agents.filter((agent) => agent.enabled === 1 && agent.id !== primaryAgent.id);
  if (!workerAgents.length) {
    throw new Error("没有可分配的其他AI，请至少再启用一个AI。");
  }

  options.onStatus?.({ stage: "planning", content: "正在分析任务..." });
  const planText = await runAgent(primaryAgent, buildPlanningPrompt(userMessage, workerAgents), conversationId, {
    signal: options.signal,
    parentMessageId: options.parentMessageId,
    onDelta: () => undefined,
  });

  const assignments = parseAssignments(planText, workerAgents);
  if (!assignments.length) {
    throw new Error(`主AI没有返回可执行的分工方案。原始返回：${planText.slice(0, 500)}`);
  }

  const tasks: ManualAgentTask[] = assignments.map((assignment) => ({ agent: assignment.agent, task: assignment.task }));
  options.onStatus?.({ stage: "plan", content: `决定分工：${tasks.map((task) => `${task.agent.name}：${task.task}`).join("；")}` });
  options.onStatus?.({ stage: "collecting", content: "收集结果中..." });

  const results = await runMultipleAgents(tasks, {
    signal: options.signal,
    conversationId,
    parentMessageId: options.parentMessageId,
  });

  options.onStatus?.({ stage: "summarizing", content: "主AI正在汇总结果..." });
  return runAgent(primaryAgent, buildSummaryPrompt(userMessage, tasks, results), conversationId, {
    signal: options.signal,
    parentMessageId: options.parentMessageId,
    onDelta: (delta) => options.onFinalDelta?.(delta),
  });
}

function buildPlanningPrompt(userMessage: string, agents: AIAgent[]) {
  const agentList = agents
    .map((agent) => `- ${agent.name}: ${agent.description || agent.rolePreset || "无简介"}`)
    .join("\n");
  return `你是多AI协作的协调者。请根据用户任务，从可用AI中选择最合适的1到3个，并分配清晰任务。\n\n用户任务：\n${userMessage}\n\n可用AI：\n${agentList}\n\n请只输出JSON，不要输出解释。格式：\n{\n  "tasks": [\n    {"agent": "AI名字", "task": "具体任务"}\n  ]\n}`;
}

function buildSummaryPrompt(userMessage: string, tasks: ManualAgentTask[], results: AgentResult[]) {
  const taskText = tasks.map((task, index) => `${index + 1}. ${task.agent.name}: ${task.task}`).join("\n");
  const resultText = results
    .map((result, index) => {
      const body = result.error ? `失败：${result.error}` : result.content;
      return `## ${index + 1}. ${result.agentName}\n${body}`;
    })
    .join("\n\n");
  return `用户原始任务：\n${userMessage}\n\n你刚才分配的任务：\n${taskText}\n\n各AI执行结果：\n${resultText}\n\n请作为主AI给用户一个最终汇总回复。要求：\n- 简洁直接\n- 合并重复内容\n- 明确结论和下一步\n- 如果某个AI失败，说明影响，不要编造其结果`;
}

function parseAssignments(text: string, agents: AIAgent[]): Array<{ agent: AIAgent; task: string }> {
  const parsed = tryParsePlan(text);
  const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  const assignments: Array<{ agent: AIAgent; task: string }> = [];
  for (const item of rawTasks) {
    const name = typeof item?.agent === "string" ? item.agent : typeof item?.agentName === "string" ? item.agentName : "";
    const task = typeof item?.task === "string" ? item.task.trim() : "";
    const agent = findAgentByName(name, agents);
    if (agent && task) {
      assignments.push({ agent, task });
    }
  }
  return uniqueAssignments(assignments).slice(0, 3);
}

function tryParsePlan(text: string): { tasks?: Array<{ agent?: string; agentName?: string; task?: string }> } | null {
  const candidates = [text, extractJsonObject(text)].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { tasks?: Array<{ agent?: string; agentName?: string; task?: string }> };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return "";
  }
  return text.slice(start, end + 1);
}

function findAgentByName(name: string, agents: AIAgent[]) {
  const clean = name.trim();
  const lower = clean.toLowerCase();
  return (
    agents.find((agent) => agent.name === clean) ??
    agents.find((agent) => agent.name.toLowerCase() === lower) ??
    agents.find((agent) => agent.name.includes(clean) || clean.includes(agent.name))
  );
}

function uniqueAssignments(assignments: Array<{ agent: AIAgent; task: string }>) {
  const seen = new Set<string>();
  const result: Array<{ agent: AIAgent; task: string }> = [];
  for (const assignment of assignments) {
    const key = `${assignment.agent.id}:${assignment.task}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(assignment);
  }
  return result;
}