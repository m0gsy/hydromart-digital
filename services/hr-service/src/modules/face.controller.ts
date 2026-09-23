import { Body, Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { FaceService } from '../application/services/face.service';
import { EnrollFaceDto, WithdrawFaceResponseDto } from './dto/attendance.dto';
import { decodeBase64Image } from './decode-image';
import { FaceEmbedding } from '../../prisma/generated/client';
import { FaceEmbeddingResponseDto } from './dto/responses.generated.dto';

/** Self face-enrollment (PWA): a linked employee enrolls their own face. No @Roles —
 *  ownership is the caller's authSubjectId. Static path sits under the attendance segment. */
@ApiTags('HR Face')
@ApiBearerAuth()
@Controller({ path: 'attendance/me/face', version: '1' })
export class SelfFaceController {
  constructor(private readonly face: FaceService) {}

  @ApiOkResponse({ type: FaceEmbeddingResponseDto })
  @Post('enroll')
  @ApiOperation({ summary: 'Enroll my own face frames (self)' })
  enroll(@Body() dto: EnrollFaceDto, @CurrentUser() user: AuthenticatedUser): Promise<FaceEmbedding> {
    return this.face.enrollSelf(user, dto.images.map(decodeBase64Image), dto.consent === true);
  }

  /** HR-3: withdraw my consent — templates and stored frames deleted, consent cleared. */
  @ApiOkResponse({ type: WithdrawFaceResponseDto })
  @Delete()
  @ApiOperation({ summary: 'Withdraw my biometric consent and delete my face data' })
  async withdraw(@CurrentUser() user: AuthenticatedUser): Promise<{ deleted: number }> {
    return this.face.withdrawConsent(await this.face.employeeFor(user));
  }
}

/** Face enrollment for an employee (HR admin). One active embedding set per employee. */
@ApiTags('HR Face')
@ApiBearerAuth()
@Controller({ path: 'employees/:id/face', version: '1' })
export class FaceController {
  constructor(private readonly face: FaceService) {}

  @ApiOkResponse({ type: FaceEmbeddingResponseDto })
  @Post('enroll')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Enroll aligned face frames (replaces the current set)' })
  enroll(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollFaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FaceEmbedding> {
    const images = dto.images.map(decodeBase64Image);
    return this.face.enroll(user, id, images, dto.sourcePhotoUrl ?? null, dto.consent === true);
  }

  /** HR-3: withdrawal on the employee's behalf (they asked at the desk, or they left). */
  @ApiOkResponse({ type: WithdrawFaceResponseDto })
  @Delete()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Delete this employee’s face data and clear their consent' })
  async withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: number }> {
    return this.face.withdrawConsent(await this.face.employeeFor(user, id));
  }
}
