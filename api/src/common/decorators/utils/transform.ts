import { isNaN } from "lodash";

export const transformToBoolean = ({
  obj,
  key
}) => {
  const val = obj ? obj[key] : undefined;
  if ([null, undefined, ''].includes(val)) return undefined;
  if (typeof val === 'string') {
    return !['false', '0'].includes(val);
  }
  if (typeof val === 'boolean') {
    return val;
  }
  return !!val;
};

export const transformToDate = ({
  obj,
  key
}) => {
  const val = obj ? obj[key] : undefined;

  if ([null, undefined, ''].includes(val)) return undefined;
  const dateCheck = new Date(val);
  const isDate = (dateCheck as any !== 'Invalid Date') && !isNaN(dateCheck);

  return isDate ? dateCheck : undefined;
};