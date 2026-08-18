import { MongooseModule } from '@nestjs/mongoose';

import {
  // Shared schemas
  File, FileSchema
} from './index';

export const mongooseFeatures = MongooseModule.forFeature([
  { name: File.name, schema: FileSchema }
]);
