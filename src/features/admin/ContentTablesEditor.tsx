import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { ContentTable } from '@/features/lessons/domain/content.schemas';
import { newContentTable } from '@/features/lessons/domain/content-tables';
import { AdminIconButton } from './AdminIconButton';
import { ReorderableItem, reorderById } from './ReorderableItem';
import { moveItem } from './lesson-management.service';
import { ValidationScope, ValidatedFormField, ValidatedTextareaField, type ValidationPathPart } from './lesson-validation';

function OrderActions({
  label,
  index,
  count,
  move,
  remove,
  removeDisabled = false,
}: {
  label: string;
  index: number;
  count: number;
  move: (direction: -1 | 1) => void;
  remove: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className="content-table-editor__actions">
      <AdminIconButton
        icon="up"
        label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => move(-1)}
      />
      <AdminIconButton
        icon="down"
        label={`Move ${label} down`}
        disabled={index === count - 1}
        onClick={() => move(1)}
      />
      <AdminIconButton
        icon="delete"
        label={`Remove ${label}`}
        disabled={removeDisabled}
        onClick={remove}
      />
    </div>
  );
}

export function ContentTablesEditor({
  tables,
  onChange,
  validationPath = [],
}: {
  tables: ContentTable[];
  onChange: (tables: ContentTable[]) => void;
  validationPath?: ValidationPathPart[];
}) {
  const group = useId();
  const [removal, setRemoval] = useState<{
    tableId: string;
    columnId?: string;
    rowId?: string;
  } | null>(null);
  const update = (table: ContentTable) =>
    onChange(tables.map((item) => (item.id === table.id ? table : item)));
  const remove = () => {
    if (!removal) return;
    const table = tables.find((item) => item.id === removal.tableId);
    if (table && removal.columnId && table.columns.length > 1) {
      update({
        ...table,
        columns: table.columns.filter((column) => column.id !== removal.columnId),
        rows: table.rows.map((row) => ({
          ...row,
          cells: Object.fromEntries(
            Object.entries(row.cells).filter(([id]) => id !== removal.columnId),
          ),
        })),
      });
    } else if (table && removal.rowId) {
      update({ ...table, rows: table.rows.filter((row) => row.id !== removal.rowId) });
    } else if (!removal.columnId) {
      onChange(tables.filter((item) => item.id !== removal.tableId));
    }
    setRemoval(null);
  };
  return (
    <ValidationScope path={validationPath}>
    <div className="content-tables-editor">
      {tables.map((table, tableIndex) => (
        <ReorderableItem
          key={table.id}
          group={group}
          id={table.id}
          label={`table ${tableIndex + 1}`}
          onReorder={(source, target, side) =>
            onChange(reorderById(tables, source, target, side, (item) => item.id))
          }
        >
          {(handle) => (
            <ValidationScope path={[tableIndex]}>
            <details className="content-table-editor" open>
              <summary>
                {handle}
                <span>
                  Table {tableIndex + 1}
                  {table.title ? ` · ${table.title}` : ''}
                </span>
              </summary>
              <div className="content-table-editor__body">
                <OrderActions
                  label={`table ${tableIndex + 1}`}
                  index={tableIndex}
                  count={tables.length}
                  move={(direction) => onChange(moveItem(tables, tableIndex, direction))}
                  remove={() => setRemoval({ tableId: table.id })}
                />
                <ValidatedFormField
                  label="Table title (optional)"
                  validationPath={['title']}
                    value={table.title ?? ''}
                    onChange={(event) => update({ ...table, title: event.target.value })}
                  />
                <fieldset>
                  <legend>Columns</legend>
                  {table.columns.map((column, index) => (
                    <ReorderableItem
                      key={column.id}
                      group={`${group}-${table.id}-columns`}
                      id={column.id}
                      label={`column ${index + 1}`}
                      onReorder={(source, target, side) =>
                        update({
                          ...table,
                          columns: reorderById(
                            table.columns,
                            source,
                            target,
                            side,
                            (item) => item.id,
                          ),
                        })
                      }
                    >
                      {(columnHandle) => (
                        <ValidationScope path={['columns', index]}>
                        <div className="content-table-editor__column">
                          {columnHandle}
                          <ValidatedFormField
                            label={`Column ${index + 1}`}
                            validationPath={['label']}
                              required
                              value={column.label}
                              onChange={(event) =>
                                update({
                                  ...table,
                                  columns: table.columns.map((item) =>
                                    item.id === column.id
                                      ? { ...item, label: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          <OrderActions
                            label={`column ${index + 1}`}
                            index={index}
                            count={table.columns.length}
                            move={(direction) =>
                              update({
                                ...table,
                                columns: moveItem(table.columns, index, direction),
                              })
                            }
                            removeDisabled={table.columns.length === 1}
                            remove={() => setRemoval({ tableId: table.id, columnId: column.id })}
                          />
                        </div>
                        </ValidationScope>
                      )}
                    </ReorderableItem>
                  ))}
                  <button
                    type="button"
                    className="admin-add-action"
                    onClick={() => {
                      const id = crypto.randomUUID();
                      update({
                        ...table,
                        columns: [
                          ...table.columns,
                          { id, label: `Column ${table.columns.length + 1}` },
                        ],
                        rows: table.rows.map((row) => ({
                          ...row,
                          cells: { ...row.cells, [id]: '' },
                        })),
                      });
                    }}
                  >
                    Add column
                  </button>
                </fieldset>
                <fieldset>
                  <legend>Rows</legend>
                  {table.rows.map((row, index) => (
                    <ReorderableItem
                      key={row.id}
                      group={`${group}-${table.id}-rows`}
                      id={row.id}
                      label={`row ${index + 1}`}
                      onReorder={(source, target, side) =>
                        update({
                          ...table,
                          rows: reorderById(table.rows, source, target, side, (item) => item.id),
                        })
                      }
                    >
                      {(rowHandle) => (
                        <ValidationScope path={['rows', index]}>
                        <div className="content-table-editor__row">
                          <div className="content-table-editor__actions">
                            {rowHandle}
                            <span>Row {index + 1}</span>
                            <OrderActions
                              label={`row ${index + 1}`}
                              index={index}
                              count={table.rows.length}
                              move={(direction) =>
                                update({ ...table, rows: moveItem(table.rows, index, direction) })
                              }
                              remove={() => setRemoval({ tableId: table.id, rowId: row.id })}
                            />
                          </div>
                          <div className="content-table-editor__cells">
                            {table.columns.map((column) => (
                              <ValidatedTextareaField
                                key={column.id}
                                label={`${column.label} ${index + 1}`}
                                validationPath={['cells', column.id]}
                                  value={row.cells[column.id] ?? ''}
                                  onChange={(event) =>
                                    update({
                                      ...table,
                                      rows: table.rows.map((item) =>
                                        item.id === row.id
                                          ? {
                                              ...item,
                                              cells: {
                                                ...item.cells,
                                                [column.id]: event.target.value,
                                              },
                                            }
                                          : item,
                                      ),
                                    })
                                  }
                                />
                            ))}
                          </div>
                        </div>
                        </ValidationScope>
                      )}
                    </ReorderableItem>
                  ))}
                  <button
                    type="button"
                    className="admin-add-action"
                    onClick={() =>
                      update({
                        ...table,
                        rows: [
                          ...table.rows,
                          {
                            id: crypto.randomUUID(),
                            cells: Object.fromEntries(
                              table.columns.map((column) => [column.id, '']),
                            ),
                          },
                        ],
                      })
                    }
                  >
                    Add row
                  </button>
                </fieldset>
              </div>
            </details>
            </ValidationScope>
          )}
        </ReorderableItem>
      ))}
      <button
        type="button"
        className="admin-add-action"
        onClick={() =>
          onChange([...tables, newContentTable()])
        }
      >
        Add table
      </button>
      <ConfirmDialog
        open={removal !== null}
        title="Remove table content?"
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setRemoval(null)}
      >
        This removes the selected{' '}
        {removal?.columnId ? 'column and its cells' : removal?.rowId ? 'row' : 'table'} from the
        draft. Published content stays unchanged until publishing.
      </ConfirmDialog>
    </div>
    </ValidationScope>
  );
}
