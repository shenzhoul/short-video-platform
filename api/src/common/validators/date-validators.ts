import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Custom validator decorator that accepts either:
 * - A valid ISO 8601 date string (e.g., "2023-10-13T00:00:00.000Z")
 * - A timestamp number as a string (e.g., "1760342567719")
 *
 * This is useful for API parameters that need to support both date formats for backward compatibility.
 */
export function IsDateStringOrTimestamp(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isDateStringOrTimestamp',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          // Check if it's a valid ISO date string
          const date = new Date(value);
          if (!isNaN(date.getTime()) && date.toISOString().startsWith(value.slice(0, 10))) {
            return true;
          }
          // Check if it's a valid timestamp number as string
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            const dateFromNum = new Date(num);
            return !isNaN(dateFromNum.getTime());
          }
          return false;
        },
        defaultMessage(_args: ValidationArguments) {
          return `${_args.property} must be a valid ISO 8601 date string or a valid timestamp number`;
        }
      }
    });
  };
}
