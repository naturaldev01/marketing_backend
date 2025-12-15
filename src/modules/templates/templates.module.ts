import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { ImagesController } from './images.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TemplatesController, ImagesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
