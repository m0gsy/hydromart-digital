import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { FaceService } from '../application/services/face.service';
import { EnrollFaceDto } from './dto/attendance.dto';
import { decodeBase64Image } from './decode-image';

/** Self face-enrollment (PWA): a linked employee enrolls their own face. No @Roles —
 *  ownership is the caller's authSubjectId. Static path sits under the attendance segment. */
@ApiTags('HR Face')
@ApiBearerAuth()
@Controller({ path: 'attendance/me/face', version: '1' })
export class SelfFaceController {
  constructor(private readonly face: FaceService) {}

  @Post('enroll')
  @ApiOperation({ summary: 'Enroll my own face frames (self)' })
  enroll(@Body() dto: EnrollFaceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.face.enrollSelf(user, dto.images.map(decodeBase64Image));
  }
}

/** Face enrollment for an employee (HR admin). One active embedding set per employee. */
@ApiTags('HR Face')
@ApiBearerAuth()
@Controller({ path: 'employees/:id/face', version: '1' })
export class FaceController {
  constructor(private readonly face: FaceService) {}

  @Post('enroll')
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Enroll aligned face frames (replaces the current set)' })
  enroll(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollFaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const images = dto.images.map(decodeBase64Image);
    return this.face.enroll(user, id, images, dto.sourcePhotoUrl ?? null);
  }
}
