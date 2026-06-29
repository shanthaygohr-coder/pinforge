import { Module } from '@nestjs/common';
import { PinterestHttpClient } from './pinterest-http.client';
import { PinterestPublishService } from './pinterest-publish.service';
import { PinterestOAuthService } from './pinterest-oauth.service';
import { BoardMatcherService } from './board-matcher.service';
import { PinterestController } from './pinterest.controller';

@Module({
  controllers: [PinterestController],
  providers: [PinterestHttpClient, PinterestPublishService, PinterestOAuthService, BoardMatcherService],
  exports: [PinterestHttpClient, PinterestPublishService, PinterestOAuthService, BoardMatcherService],
})
export class PinterestModule {}
