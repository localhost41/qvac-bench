export interface PromptFixture {
  name: string;
  description: string;
  prompt: string;
}

export const promptFixtures = [
  {
    name: "hello",
    description: "Short greeting baseline.",
    prompt: "Say hello in one short sentence."
  },
  {
    name: "summary",
    description: "Concise summarization baseline.",
    prompt:
      "Summarize this in two bullet points: QVAC is a local OpenAI-compatible model server for developer workflows."
  },
  {
    name: "reasoning",
    description: "Small multi-step reasoning baseline.",
    prompt: "A train leaves at 3:00 PM and travels for 2 hours and 45 minutes. What time does it arrive?"
  }
] as const satisfies readonly PromptFixture[];

export type PromptName = (typeof promptFixtures)[number]["name"];

export function promptNames(): string[] {
  return promptFixtures.map((fixture) => fixture.name);
}

export function findPromptFixture(name: string): PromptFixture | undefined {
  return promptFixtures.find((fixture) => fixture.name === name);
}
