import React, { useCallback, useRef, useEffect, useState } from 'react';
import { GripVertical, KeyRound } from 'lucide-react';
import { Input } from '@/components/input/input';
import type { DBField } from '@/lib/domain/db-field';
import { useChartDB } from '@/hooks/use-chartdb';
import {
    dataTypeDataToDataType,
    sortedDataTypeMap,
} from '@/lib/data/data-types/data-types';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/tooltip/tooltip';
import { useTranslation } from 'react-i18next';
import { TableFieldToggle } from './table-field-toggle';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SelectBoxProps, SelectBoxOption } from '@/components/select-box/select-box';
import { SelectBox } from '@/components/select-box/select-box';
import { TableFieldPopover } from './table-field-modal/table-field-modal';
import { debounce } from 'lodash';

export interface TableFieldProps {
    field: DBField;
    updateField: (attrs: Partial<DBField>) => void;
    removeField: () => void;
}

export const TableField: React.FC<TableFieldProps> = React.memo(({
    field,
    updateField,
    removeField,
}) => {
    const { databaseType } = useChartDB();
    const { t } = useTranslation();
    
    const debouncedUpdateRef = useRef(
        debounce((value: Partial<DBField>) => {
            updateField(value);
        }, 200)
    );

    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.id });

    const dataFieldOptions: SelectBoxOption[] = React.useMemo(() => sortedDataTypeMap[databaseType].map((type) => ({
        label: type.name,
        value: type.id,
        regex: type.hasCharMaxLength ? `^${type.name}\\(\\d+\\)$` : undefined,
        extractRegex: type.hasCharMaxLength ? /\((\d+)\)/ : undefined,
    })), [databaseType]);    const [localName, setLocalName] = useState(field.name);

    // Keep local name in sync with prop
    useEffect(() => {
        setLocalName(field.name);
    }, [field.name]);

    const handleFieldNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setLocalName(newValue); // Update local state immediately for responsive typing
        debouncedUpdateRef.current({ name: newValue });
    }, []);

    const handleDataTypeChange = useCallback<NonNullable<SelectBoxProps['onChange']>>((value, regexMatches) => {
        const dataType = sortedDataTypeMap[databaseType].find((v) => v.id === value) ?? {
            id: value as string,
            name: value as string,
        };

        const update: Partial<DBField> = {
            type: dataTypeDataToDataType(dataType)
        };

        if (regexMatches?.length && dataType?.hasCharMaxLength) {
            update.characterMaximumLength = regexMatches[1];
        } else if (field.characterMaximumLength && dataType?.hasCharMaxLength) {
            update.characterMaximumLength = field.characterMaximumLength;
        }

        debouncedUpdateRef.current(update);
    }, [databaseType, field.characterMaximumLength]);

    // Cleanup the debounced function on unmount
    useEffect(() => {
        return () => {
            debouncedUpdateRef.current.cancel();
        };
    }, []);

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
    };

    return (
        <div className="flex flex-1 touch-none flex-row justify-between p-1" ref={setNodeRef} style={style} {...attributes}>
            <div className="flex w-8/12 items-center justify-start gap-1 overflow-hidden">
                <div className="flex w-4 shrink-0 cursor-move items-center justify-center" {...listeners}>
                    <GripVertical className="size-3.5 text-muted-foreground" />
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="w-5/12">
                            <Input
                                className="h-8 w-full !truncate focus-visible:ring-0"
                                type="text"
                                placeholder={t('side_panel.tables_section.table.field_name')}                                value={localName}
                                onChange={handleFieldNameChange}
                            />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{field.name}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger className="flex h-8 !w-5/12" asChild>
                        <span>
                            <SelectBox
                                className="flex h-8 min-h-8 w-full"
                                options={dataFieldOptions}
                                placeholder={t('side_panel.tables_section.table.field_type')}
                                value={field.type.id}
                                valueSuffix={field.characterMaximumLength ? `(${field.characterMaximumLength})` : ''}
                                optionSuffix={(option) => {
                                    const type = sortedDataTypeMap[databaseType].find((v) => v.id === option.value);
                                    if (!type) return '';
                                    if (type.hasCharMaxLength) {
                                        return `(${!field.characterMaximumLength ? 'n' : field.characterMaximumLength})`;
                                    }
                                    return '';
                                }}
                                onChange={handleDataTypeChange}
                                emptyPlaceholder={t('side_panel.tables_section.table.no_types_found')}
                            />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {field.type.name}
                        {field.characterMaximumLength ? `(${field.characterMaximumLength})` : ''}
                    </TooltipContent>
                </Tooltip>
            </div>
            <div className="flex w-4/12 justify-end gap-1 overflow-hidden">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>
                            <TableFieldToggle
                                pressed={field.nullable}
                                onPressedChange={(value) => debouncedUpdateRef.current({ nullable: value })}
                            >
                                N
                            </TableFieldToggle>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('side_panel.tables_section.table.nullable')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>
                            <TableFieldToggle
                                pressed={field.primaryKey}
                                onPressedChange={(value) => debouncedUpdateRef.current({
                                    unique: value,
                                    primaryKey: value,
                                })}
                            >
                                <KeyRound className="h-3.5" />
                            </TableFieldToggle>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('side_panel.tables_section.table.primary_key')}</TooltipContent>
                </Tooltip>
                <TableFieldPopover
                    field={field}
                    updateField={updateField}
                    removeField={removeField}
                />
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.field.id === nextProps.field.id &&
           prevProps.field.name === nextProps.field.name &&
           prevProps.field.type.id === nextProps.field.type.id &&
           prevProps.field.characterMaximumLength === nextProps.field.characterMaximumLength &&
           prevProps.field.unique === nextProps.field.unique &&
           prevProps.field.primaryKey === nextProps.field.primaryKey &&
           prevProps.field.nullable === nextProps.field.nullable &&
           prevProps.field.comments === nextProps.field.comments;
});
