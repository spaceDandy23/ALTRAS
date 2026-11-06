import { FormField } from '@/components/ui/FormField';
import { moveItem } from './lesson-management.service';
import { ReorderableItem, reorderById } from './ReorderableItem';
import { Fragment, type ReactNode } from 'react';
import { AdminIconButton } from './AdminIconButton';

export type EditableChoice = { id: string; label: string };

export function ChoiceRowsEditor({
  choices,
  onChange,
  legend,
  choiceLabel = 'Choice',
  controlLabel = 'choice',
  addLabel = 'Add choice',
  maxChoices,
  choiceMaxLength,
  choiceRequired,
  radioGroupName,
  choiceIdPrefix = '',
  correctChoiceId,
  onCorrectChoiceChange,
  reorderGroup,
}: {
  choices: EditableChoice[];
  onChange: (choices: EditableChoice[]) => void;
  legend: string;
  choiceLabel?: string;
  controlLabel?: string;
  addLabel?: string;
  maxChoices: number;
  choiceMaxLength?: number;
  choiceRequired?: boolean;
  radioGroupName?: string;
  choiceIdPrefix?: string;
  correctChoiceId?: string;
  onCorrectChoiceChange?: (choiceId: string) => void;
  reorderGroup?: string;
}) {
  return (
    <fieldset className="admin-options">
      <legend>{legend}</legend>
      {choices.map((choice, index) => {
        const row = (handle: ReactNode) => (
        <div className="admin-option">
          {handle}
          {onCorrectChoiceChange && (
            <label className="admin-correct-choice">
              <input
                type="radio"
                name={radioGroupName ?? `correct-choice-${legend}`}
                checked={correctChoiceId === choice.id}
                onChange={() => onCorrectChoiceChange(choice.id)}
              />
              Correct
            </label>
          )}
          <FormField
            label={`${choiceLabel} ${index + 1}`}
            value={choice.label}
            maxLength={choiceMaxLength}
            required={choiceRequired}
            onChange={(event) =>
              onChange(
                choices.map((item) =>
                  item.id === choice.id ? { ...item, label: event.target.value } : item,
                ),
              )
            }
          />
          <AdminIconButton icon="up" label={`Move ${controlLabel} ${index + 1} up`}
            disabled={index === 0}
            onClick={() => onChange(moveItem(choices, index, -1))}
          />
          <AdminIconButton icon="down" label={`Move ${controlLabel} ${index + 1} down`}
            disabled={index === choices.length - 1}
            onClick={() => onChange(moveItem(choices, index, 1))}
          />
          <AdminIconButton icon="delete" label={`Remove ${controlLabel} ${index + 1}`}
            disabled={choices.length <= 2}
            onClick={() => onChange(choices.filter((item) => item.id !== choice.id))}
          />
        </div>
        );
        return reorderGroup ? (
          <ReorderableItem key={choice.id} group={reorderGroup} id={choice.id}
            label={`${choiceLabel.toLowerCase()} ${index + 1}`}
            onReorder={(source, target, side) => onChange(reorderById(choices, source, target, side, (item) => item.id))}>
            {row}
          </ReorderableItem>
        ) : <Fragment key={choice.id}>{row(null)}</Fragment>;
      })}
      <button
        type="button"
        className="admin-add-action"
        disabled={choices.length >= maxChoices}
        onClick={() => onChange([...choices, { id: `${choiceIdPrefix}${crypto.randomUUID()}`, label: '' }])}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
