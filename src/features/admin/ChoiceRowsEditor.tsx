import { FormField } from '@/components/ui/FormField';
import { moveItem } from './lesson-management.service';

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
}) {
  return (
    <fieldset className="admin-options">
      <legend>{legend}</legend>
      {choices.map((choice, index) => (
        <div key={choice.id} className="admin-option">
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
          <button
            type="button"
            disabled={index === 0}
            aria-label={`Move ${controlLabel} ${index + 1} up`}
            onClick={() => onChange(moveItem(choices, index, -1))}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index === choices.length - 1}
            aria-label={`Move ${controlLabel} ${index + 1} down`}
            onClick={() => onChange(moveItem(choices, index, 1))}
          >
            ↓
          </button>
          <button
            type="button"
            disabled={choices.length <= 2}
            aria-label={`Remove ${controlLabel} ${index + 1}`}
            onClick={() => onChange(choices.filter((item) => item.id !== choice.id))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={choices.length >= maxChoices}
        onClick={() => onChange([...choices, { id: `${choiceIdPrefix}${crypto.randomUUID()}`, label: '' }])}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
