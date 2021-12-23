import {ReflectUtils} from '../../classes';
import {TAnyFieldOptions} from './types';
import {getReflectedSupportedType} from './utils';
import {TAnyFieldType} from '../../types';

/**
 * Декоратор, который объявляет указанное свойство в классе, свойством в
 * документе БД.
 * @param typeOrOptions
 * @constructor
 */
export function Field(typeOrOptions?: TAnyFieldOptions) {
  return (target: Object, propertyKey: string) => {
    // Получаем класс, которому принадлежит текущее поле.
    const Model = target.constructor;

    let type: TAnyFieldType;
    let isNullable = true;
    let dbPropertyName = propertyKey;
    let defaultValue: any;
    let isIdentifier = false;

    if (typeOrOptions === undefined) {
      type = getReflectedSupportedType(target, propertyKey);
    } else {
      const {
        nullable = isNullable,
        name = dbPropertyName,
        defaultValue: typeDefaultValue,
        id = isIdentifier,
      } = typeOrOptions;
      dbPropertyName = name;
      defaultValue = typeDefaultValue;
      isNullable = nullable;
      isIdentifier = id;
      type = 'type' in typeOrOptions
        ? typeOrOptions.type
        : getReflectedSupportedType(target, propertyKey);
    }

    // Добавляем поле в модель.
    ReflectUtils.addOwnField(Model, {
      classPropertyName: propertyKey,
      dbPropertyName,
      defaultValue,
      isNullable,
      isIdentifier,
      type,
    });
  }
}