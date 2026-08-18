import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';
import { isNaN } from 'lodash';

@ValidatorConstraint({ async: true })
export class IsValidDateStringConstraint implements ValidatorConstraintInterface {
  validate(text: string) {
    if (!text) {
      return false;
    }

    const passParse = Date.parse(text) > 0;
    if (!passParse) {
      const dateCheck = new Date(text);
      const isDate = (dateCheck as any !== 'Invalid Date') && !isNaN(dateCheck);
      return isDate;
    }
    return true;
  }

  defaultMessage() {
    return '($value) is invalid date string!';
  }
}

export function IsValidDateString(validationOptions?: ValidationOptions) {
  return (object: Object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidDateStringConstraint
    });
  };
}
