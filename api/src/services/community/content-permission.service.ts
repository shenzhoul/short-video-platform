import { Injectable } from "@nestjs/common";
import { UserAccountManagementService } from "src/services/identity";
import { ObjectId } from 'mongodb';
import { UserDto } from "src/dtos/identity/user";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { USER_STATUS } from "src/common/constants";

/**
 * Interface for social permission checking
 * Defines core permission methods for social interactions
 */
export interface ISocialPermissionChecker {
  canComment(contentId: string, user: UserDto | AuthUserDto): Promise<boolean>;
  canReact(contentId: string, user: UserDto | AuthUserDto): Promise<boolean>;
}

/**
 * ContentPermissionService
 *
 * Handles permission checking for social interactions on content.
 * This service validates if users can perform social actions like
 * commenting, reacting, and reporting on various content types.
 */
@Injectable()
export class ContentPermissionService implements ISocialPermissionChecker {
  constructor(
    private readonly userService: UserAccountManagementService
  ) { }
  /**
   * Check if user can comment on content
   *
   * @param contentId - ID of the content to comment on
   * @param user - User attempting to comment
   * @returns Promise<boolean> - true if user can comment
   */
  async canComment(contentId: string | ObjectId, user: UserDto | AuthUserDto): Promise<boolean> {
    try {
      // Basic validation - user must be authenticated
      if (!user || !user._id) {
        return false;
      }

      // Content ID must be valid
      if (!contentId) {
        return false;
      }

      // Check if content creator is deleted (admins bypass this)
      if (!user.isAdmin) {
        const creatorStatus = await this.getContentCreatorStatus(contentId);
        if (creatorStatus === USER_STATUS.DELETED) {
          return false;
        }
      }

      // For now, allow all authenticated users to comment
      // This will be extended with specific content type logic
      // when integrated with actual content services

      // TODO: Add specific checks for:
      // - Content exists and is active
      // - User is not blocked by content owner
      // - Content allows comments (if paid content, check subscription)
      // - User has not been banned from commenting

      return true;
    } catch {
      // Log error and deny permission on any exception
      return false;
    }
  }

  /**
 * Check if user can view content
 *
 * @param contentId - ID of the content to view
 * @param _user - User attempting to view (optional for public content) - reserved for future use
 * @returns Promise<boolean> - true if user can view
 */
  async canView(contentId: string | ObjectId): Promise<boolean> {
    try {
      // Content ID must be valid
      if (!contentId) {
        return false;
      }

      // For now, allow viewing for all users (public content)
      // TODO: Add specific business logic for private/paid content
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper method to get creator status from content ID
   * This method attempts to find the creator of the content
   *
   * @param contentId - Content ID (could be post, product, etc.)
   * @returns Promise<string | null> - Creator status or null
   */
  private async getContentCreatorStatus(contentId: string | ObjectId): Promise<string | null> {
    try {
      // Try to get creator from content ID
      // This assumes contentId might be a creator ID itself
      // or we need to resolve it from the content
      const creator = await this.userService.findById(contentId);
      if (creator) {
        return creator.status;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if user can react to content
   *
   * @param contentId - ID of the content to react to
   * @param user - User attempting to react
   * @returns Promise<boolean> - true if user can react
   */
  async canReact(contentId: string | ObjectId, user: UserDto | AuthUserDto): Promise<boolean> {
    try {
      // Basic validation
      if (!user || !user._id || !contentId) {
        return false;
      }

      // Check if content creator is deleted (admins bypass this)
      if (!user.isAdmin) {
        const creatorStatus = await this.getContentCreatorStatus(contentId);
        if (creatorStatus === USER_STATUS.DELETED) {
          return false;
        }
      }

      // For now, allow all authenticated users to react
      // TODO: Add specific business logic
      return true;
    } catch {
      return false;
    }
  }
}