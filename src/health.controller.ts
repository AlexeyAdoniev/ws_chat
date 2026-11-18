import { All, Controller, Get, HttpCode } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  @All('{*path}')
  @HttpCode(404)
  getNotFound(): { error: string } {
    return { error: 'Not found' };
  }
}
