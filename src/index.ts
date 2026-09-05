import { createServer, Tool, z } from '@nitrostack/core';

const server = createServer({
  name: 'agent-commerce',
  version: '1.0.0',
  description: 'Agent Commerce Interface',
});

server.tool(
  new Tool({
    name: 'hello',
    description: 'Say hello to someone',
    inputSchema: z.object({
      name: z.string().describe('The name to greet'),
    }),
    handler: async (input, context) => {
      context.logger.info(`Greeting ${input.name}`);
      return `Hello, ${input.name}! 👋`;
    },
  })
);

server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
