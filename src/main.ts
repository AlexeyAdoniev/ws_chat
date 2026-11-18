import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`Server listening on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Application startup failed:', error);
  process.exit(1);
});
