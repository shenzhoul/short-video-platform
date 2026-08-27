import { PickType } from '@nestjs/swagger';
import {
  IsEmail, IsNotEmpty, IsString
} from 'class-validator';
import { UserCreatePayload } from 'src/payloads/identity/user/user-create.payload';
import { HashedPassword } from 'src/payloads/shared/validation-utils';

/**
 * The exact set of fields a visitor may send when creating their own account.
 *
 * These are the profile fields, and only the profile fields, that the signup
 * form renders. `email` and `password` are added below; everything else comes
 * from `UserCreatePayload`, so the username rules, the gender whitelist and the
 * name handling cannot drift between public signup and the admin create form.
 *
 * `dateOfBirth` is deliberately **not** here even though the shared base class
 * declares it: the signup form does not ask for it, and a field the form cannot
 * produce has no business being reachable from an open endpoint.
 */
const PUBLIC_SIGNUP_FIELDS = ['firstName', 'lastName', 'name', 'username', 'gender'] as const;

/**
 * Public self-registration payload.
 *
 * `PickType`, not `OmitType`, and that is the whole design. An omit list is a
 * denial list: it is correct only until somebody adds a field to
 * `UserCreatePayload`, at which point the new field silently becomes part of the
 * public API of an unauthenticated endpoint. A pick list is an allow-list — a
 * field nobody named here can never arrive, however the base class grows.
 *
 * What that keeps out, concretely:
 *
 *  - `verifiedEmail` — an internal flag. A visitor who could set it would mark
 *    their own address verified without ever receiving mail.
 *  - `status` — declared on `AdminUserCreatePayload` because an administrator
 *    legitimately creates suspended accounts. A self-registration never chooses
 *    its own status.
 *  - `isAdmin`, roles, permissions, balance — never on any create payload, and
 *    now unreachable by construction rather than by absence.
 *
 * Three layers, in order, and each one is load-bearing on its own:
 *
 *  1. this allow-list, which decides what the shape even *has*;
 *  2. `whitelist: true` on the controller's pipe, which strips anything the
 *     shape does not declare before the handler runs;
 *  3. `registerNewUser`, which assigns role, status and verified-email itself
 *     rather than reading them from the request.
 *
 * It is also what the generated Swagger schema is built from, so `/apidocs`
 * documents seven public fields and no internal ones.
 */
export class RegisterPayload extends PickType(UserCreatePayload, PUBLIC_SIGNUP_FIELDS) {
  /**
   * Required, unlike on the shared base class.
   *
   * `email` is picked up here rather than through `PickType` on purpose:
   * class-validator merges metadata along the prototype chain, so inheriting the
   * parent's `@IsOptional()` would keep winning over an added `@IsNotEmpty()`
   * and let a registration through with no address at all. Declaring it fresh on
   * a class that never inherited the optional marker is what makes it required.
   */
  @IsString()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /**
   * SHA256 hex digest produced by the web client, exactly as login and the admin
   * create form send it. The server salts and re-hashes it; it is never stored
   * as received.
   */
  @HashedPassword(8)
  password: string;
}
