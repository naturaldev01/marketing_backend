import { Module } from '@nestjs/common';
import { CsvFilesService } from './csv-files.service';
import { CsvFilesController } from './csv-files.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CsvFilesController],
  providers: [CsvFilesService],
  exports: [CsvFilesService],
})
export class CsvFilesModule {}

