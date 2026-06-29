import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: PrismaService devine disponibil in toata aplicatia fara re-import.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
