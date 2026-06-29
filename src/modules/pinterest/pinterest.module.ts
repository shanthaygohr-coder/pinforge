import { Module } from '@nestjs/common';
import { PinterestHttpClient } from './pinterest-http.client';
import { PinterestPublishService } from './pinterest-publish.service';
import { PinterestOAuthService } from './pinterest-oauth.service';
import { PinterestController } from './pinterest.controller';

@Module({
  controllers: [PinterestController],
  providers: [PinterestHttpClient, PinterestPublishService, PinterestOAuthService],
  exports: [PinterestHttpClient, PinterestPublishService, PinterestOAuthService],
})
export class PinterestModule {}
