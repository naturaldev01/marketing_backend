import { Module } from '@nestjs/common';
import { AdvertisementsController } from './advertisements.controller';
import { TrackingController } from './tracking.controller';
import { AdvertisementsService } from './advertisements.service';

@Module({
  controllers: [AdvertisementsController, TrackingController],
  providers: [AdvertisementsService],
  exports: [AdvertisementsService],
})
export class AdvertisementsModule {}

