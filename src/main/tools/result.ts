import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const ok = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }],
});

export function guarded<Args>(handler: (args: Args) => Promise<unknown>) {
	return async (args: Args): Promise<CallToolResult> => {
		try {
			return ok(await handler(args));
		} catch (error) {
			return { content: [{ type: "text", text: (error as Error).message }], isError: true };
		}
	};
}
