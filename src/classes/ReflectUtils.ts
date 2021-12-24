import 'reflect-metadata';
import {IFieldMeta, IUnpackedFieldMeta} from '../types';
import {unpackField, whileHasParentConstructor} from '../utils';
import {PropertyAlreadyDefinedError} from '../errors/PropertyAlreadyDefinedError';
import {PrimaryKeyAlreadyDefinedError} from '../errors/PrimaryKeyAlreadyDefinedError';
import {ModelNotFoundError} from '../errors/ModelNotFoundError';
import {EmptyFieldsListError} from '../errors/EnptyFieldsListError';
import {PrimaryKeyNotDefinedError} from '../errors/PrimaryKeyNotDefinedError';

enum EMetaDataKey {
  /**
   * Были ли применены поля к прототипу модели.
   */
  AreFieldsApplied,
  /**
   * Коллекция, на которую ориентируется модель.
   */
  Collection,
  /**
   * Список полей, которые присутствуют в модели.
   */
  Fields,
  /**
   * Тип объекта.
   */
  ObjectType,
  /**
   * Список распакованных полей.
   */
  UnpackedFields,
}

interface IModelInformation {
  /**
   * Наименование коллекции-источника.
   */
  collection: string;
  /**
   * Поле, являющееся идентификатором.
   */
  primaryField: IUnpackedFieldMeta;
  /**
   * Список всех полей.
   */
  fields: IUnpackedFieldMeta[];
}

interface IMetaValuesMap {
  [EMetaDataKey.AreFieldsApplied]: boolean;
  [EMetaDataKey.Collection]: string;
  [EMetaDataKey.ObjectType]: 'model' | 'data-mapper';
  [EMetaDataKey.Fields]: IFieldMeta[];
  [EMetaDataKey.UnpackedFields]: IUnpackedFieldMeta[];
}

type TKnownMeta = keyof IMetaValuesMap;

export class ReflectUtils {
  /**
   * Получает мета-данные.
   * @param key
   * @param target
   * @param propertyKey
   */
  private static get<K extends TKnownMeta>(
    key: K,
    target: Object,
    propertyKey?: string,
  ): IMetaValuesMap[K] | null {
    return (
      typeof propertyKey === 'string'
        ? Reflect.getMetadata(key, target, propertyKey)
        : Reflect.getMetadata(key, target)
    ) || null;
  }

  /**
   * Возвращает true в случае, если указанное значение имеет переданный
   * мета-ключ.
   * @param key
   * @param target
   * @param propertyKey
   */
  private static has(
    key: TKnownMeta,
    target: Object,
    propertyKey?: string
  ): boolean {
    return typeof propertyKey === 'string'
      ? Reflect.hasMetadata(key, target, propertyKey)
      : Reflect.hasMetadata(key, target);
  }

  /**
   * Устанавливает мета-данные.
   * @param key
   * @param value
   * @param target
   * @param propertyKey
   */
  private static set<K extends keyof IMetaValuesMap>(
    key: K,
    value: IMetaValuesMap[K],
    target: Object,
    propertyKey?: string,
  ) {
    if (typeof propertyKey === 'string') {
      Reflect.defineMetadata(key, value, target, propertyKey);
    } else {
      Reflect.defineMetadata(key, value, target);
    }
  }

  /**
   * Добавляет поле к модели.
   * @param target
   * @param fieldMeta
   */
  static addOwnField(target: Function, fieldMeta: IFieldMeta) {
    // TODO: Проверить defaultValue и isNullable, В дефолт нельзя null если
    //  IsNullable не true
    const fields = this.getFields(target);

    fields.forEach(f => {
      // В случае, если переданное поле - поле-идентификатор, необходимо
      // проверить, было ли ранее добавлено такое же поле.
      if (f.isPrimary && fieldMeta.isPrimary) {
        throw new PrimaryKeyAlreadyDefinedError({
          Model: target,
          prevField: f,
          currentField: fieldMeta,
        });
      }
      // Дубликаты полей запрещены.
      if (f.classPropertyName === fieldMeta.classPropertyName) {
        throw new PropertyAlreadyDefinedError({
          prevField: f,
          currentField: fieldMeta,
        });
      }
    });
    this.set(
      EMetaDataKey.Fields,
      [...this.getOwnFields(target), fieldMeta],
      target
    );
  }

  /**
   * Применяет поля в прототипу модели.
   * @param target
   */
  static applyFields(target: Function) {
    const isAlreadyApplied = this.get(EMetaDataKey.AreFieldsApplied, target) === true;

    if (isAlreadyApplied) {
      return;
    }
    const fields = this.getUnpackedFields(target);

    fields.forEach(f => {
      // Объявляем геттеры и сеттеры для полей. Они должны ссылаться на поля,
      // находящиеся в документе.
      Object.defineProperty(target.prototype, f.classPropertyName, {
        get() {
          return this.__document[f.dbPropertyName];
        },
        set(value: any) {
          this.__document[f.dbPropertyName] = value;
        },
        writable: false,
        enumerable: true,
        configurable: false,
      });
    });
    this.set(EMetaDataKey.AreFieldsApplied, true, target);
  }

  /**
   * Собирает полную информацию о модели.
   * @param target
   */
  static collectModelInformation(target: Function): IModelInformation {
    const collection = this.get(EMetaDataKey.Collection, target);

    if (collection === null) {
      throw new ModelNotFoundError(target);
    }
    const fields = this.getUnpackedFields(target);

    if (fields.length === 0) {
      throw new EmptyFieldsListError({Model: target});
    }
    let primaryField: IUnpackedFieldMeta | undefined;

    for (const f of fields) {
      if (f.isPrimary) {
        if (primaryField !== undefined) {
          throw new PrimaryKeyAlreadyDefinedError({
            Model: target,
            prevField: primaryField,
            currentField: f,
          });
        }
        primaryField = f;
      }
    }
    if (primaryField === undefined) {
      throw new PrimaryKeyNotDefinedError({Model: target});
    }
    return {collection, primaryField, fields};
  }

  /**
   * Помечает значение как модель.
   * @param target
   * @param collection
   */
  static defineModel(target: Function, collection: string) {
    this.set(EMetaDataKey.Collection, collection, target);
    this.set(EMetaDataKey.ObjectType, 'model', target);
  }

  /**
   * Помечает значение как дата-маппер.
   * @param target
   */
  static defineDataMapper(target: Function) {
    this.set(EMetaDataKey.ObjectType, 'data-mapper', target);
  }

  /**
   * Возвращает тип поля.
   * @param target
   * @param propertyKey
   */
  static getReflectedType(target: Object, propertyKey: string) {
    return Reflect.getMetadata('design:type', target, propertyKey);
  }

  /**
   * Возвращает все поля модели, включая те, которые присутствуют в
   * расширяемом классе.
   * @param target
   */
  static getFields(target: Function): IFieldMeta[] {
    const fields: IFieldMeta[] = [];

    whileHasParentConstructor(target, ctr => {
      fields.push(...this.getOwnFields(ctr));
    });
    return fields;
  }

  /**
   * Возвращает собственные поля модели.
   * @param target
   */
  static getOwnFields(target: any): IFieldMeta[] {
    return this.get(EMetaDataKey.Fields, target) || [];
  }

  /**
   * Возвращает собственные распакованные поля класса.
   * @param target
   */
  static getUnpackedOwnFields(target: Function): IUnpackedFieldMeta[] {
    let unpacked = this.get(EMetaDataKey.UnpackedFields, target);

    if (unpacked === null) {
      unpacked = this.getOwnFields(target).map(unpackField)
      this.set(EMetaDataKey.UnpackedFields, unpacked, target);
    }
    return unpacked;
  }

  /**
   * Возвращает все распакованные поля класса.
   * @param target
   */
  static getUnpackedFields(target: Function): IUnpackedFieldMeta[] {
    const fields: IUnpackedFieldMeta[] = [];

    whileHasParentConstructor(target, ctr => {
      fields.push(...this.getUnpackedOwnFields(ctr));
    });
    return fields;
  }

  /**
   * Возвращает true в случае если переданное значение содержит настройки
   * модели.
   * @param target
   */
  static isModel(target: any): boolean {
    return this.get(EMetaDataKey.ObjectType, target) === 'model';
  }

  /**
   * Возвращает true в случае, если переданное значение является
   * зарегистрированным дата-маппером.
   * @param target
   */
  static isDataMapper(target: any): boolean {
    return this.get(EMetaDataKey.ObjectType, target) === 'data-mapper';
  }

  /**
   * Проверяет, является ли переданное значение полноценной моделью.
   * @param target
   */
  static isCompleteModel(target: Function): boolean {
    const meta = this.get(EMetaDataKey.ModelMeta, target);

    if (meta === null) {
      return false;
    }
    const fields: IFieldMeta[] = [];

    whileHasParentConstructor(target, ctr => {
      const ctrFields = this.get(EMetaDataKey.ModelFields, ctr);

      if (ctrFields !== null) {
        fields.push(...ctrFields);
      }
    });
    if (fields.length === 0) {
      return false;
    }
    let hasIdentifierField = false;

    for (const f of fields) {
      if (f.isPrimary) {
        // Запрещено иметь сразу несколько идентификационных полей.
        if (hasIdentifierField) {
          return false;
        }
        hasIdentifierField = true;
      }
    }
    return hasIdentifierField;
  }
}