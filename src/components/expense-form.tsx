'use client'
import { CategorySelector } from '@/components/category-selector'
import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCategories, getExpense, getGroup, randomId } from '@/lib/api'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useActiveUser } from '@/lib/hooks'
import {
  ExpenseFormValues,
  SplittingOptions,
  expenseFormSchema,
} from '@/lib/schemas'
import { cn } from '@/lib/utils'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { match } from 'ts-pattern'
import { DeletePopup } from './delete-popup'
import { extractCategoryFromTitle } from './expense-form-actions'
import { Textarea } from './ui/textarea'
import Mexp from 'math-expression-evaluator'

const mexp = new Mexp()

export type Props = {
  group: NonNullable<Awaited<ReturnType<typeof getGroup>>>
  expense?: NonNullable<Awaited<ReturnType<typeof getExpense>>>
  categories: NonNullable<Awaited<ReturnType<typeof getCategories>>>
  onSubmit: (values: ExpenseFormValues, participantId?: string) => Promise<void>
  onDelete?: (participantId?: string) => Promise<void>
  runtimeFeatureFlags: RuntimeFeatureFlags
}

const enforceCurrencyPattern = (value: string) =>
  value
    .replace(/^\s*-/, '_') // replace leading minus with _
    .replace(/[.,]/, '#') // replace first comma with #
    .replace(/[-.,]/g, '') // remove other minus and commas characters
    .replace(/_/, '-') // change back _ to minus
    .replace(/#/, '.') // change back # to dot
    .replace(/[^-\d.]/g, '') // remove all non-numeric characters

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1)

const getDefaultSplittingOptions = (group: Props['group']) => {
  const defaultValue = {
    splitMode: 'EVENLY' as const,
    paidFor: group.participants.map(({ id }) => ({
      participant: id,
      shares: '1' as unknown as number,
    })),
  }

  if (typeof localStorage === 'undefined') return defaultValue
  const defaultSplitMode = localStorage.getItem(
    `${group.id}-defaultSplittingOptions`,
  )
  if (defaultSplitMode === null) return defaultValue
  const parsedDefaultSplitMode = JSON.parse(
    defaultSplitMode,
  ) as SplittingOptions

  if (parsedDefaultSplitMode.paidFor === null) {
    parsedDefaultSplitMode.paidFor = defaultValue.paidFor
  }

  // if there is a participant in the default options that does not exist anymore,
  // remove the stale default splitting options
  for (const parsedPaidFor of parsedDefaultSplitMode.paidFor) {
    if (
      !group.participants.some(({ id }) => id === parsedPaidFor.participant)
    ) {
      localStorage.removeItem(`${group.id}-defaultSplittingOptions`)
      return defaultValue
    }
  }

  return {
    splitMode: parsedDefaultSplitMode.splitMode,
    paidFor: parsedDefaultSplitMode.paidFor.map((paidFor) => ({
      participant: paidFor.participant,
      shares: String(paidFor.shares / 100) as unknown as number,
    })),
  }
}

async function persistDefaultSplittingOptions(
  groupId: string,
  expenseFormValues: ExpenseFormValues,
) {
  if (localStorage && expenseFormValues.saveDefaultSplittingOptions) {
    const computePaidFor = (): SplittingOptions['paidFor'] => {
      if (expenseFormValues.splitMode === 'EVENLY') {
        return expenseFormValues.paidFor.map(({ participant }) => ({
          participant,
          shares: '100' as unknown as number,
        }))
      } else if (expenseFormValues.splitMode === 'BY_AMOUNT') {
        return null
      } else {
        return expenseFormValues.paidFor
      }
    }

    const splittingOptions = {
      splitMode: expenseFormValues.splitMode,
      paidFor: computePaidFor(),
    } satisfies SplittingOptions

    localStorage.setItem(
      `${groupId}-defaultSplittingOptions`,
      JSON.stringify(splittingOptions),
    )
  }
}

export function ExpenseForm({
  group,
  expense,
  categories,
  onSubmit,
  onDelete,
  runtimeFeatureFlags,
}: Props) {
  const isCreate = expense === undefined
  const searchParams = useSearchParams()
  const getSelectedPayer = (field?: { value: string }) => {
    if (isCreate && typeof window !== 'undefined') {
      const activeUser = localStorage.getItem(`${group.id}-activeUser`)
      if (activeUser && activeUser !== 'None' && field?.value === undefined) {
        return activeUser
      }
    }
    return field?.value
  }
  const defaultSplittingOptions = getDefaultSplittingOptions(group)
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: expense
      ? {
          title: expense.title,
          expenseDate: expense.expenseDate ?? new Date(),
          amount: String(expense.amount / 100) as unknown as number, // hack
          category: expense.categoryId,
          paidBy: expense.paidById,
          paidFor: expense.paidFor.map(({ participantId, shares }) => ({
            participant: participantId,
            shares: String(shares / 100) as unknown as number,
          })),
          splitMode: expense.splitMode,
          saveDefaultSplittingOptions: false,
          isReimbursement: expense.isReimbursement,
          documents: expense.documents,
          notes: expense.notes ?? '',
        }
      : searchParams.get('reimbursement')
      ? {
          title: 'Reimbursement',
          expenseDate: new Date(),
          amount: String(
            (Number(searchParams.get('amount')) || 0) / 100,
          ) as unknown as number, // hack
          category: 1, // category with Id 1 is Payment
          paidBy: searchParams.get('from') ?? undefined,
          paidFor: [
            searchParams.get('to')
              ? {
                  participant: searchParams.get('to')!,
                  shares: '1' as unknown as number,
                }
              : undefined,
          ],
          isReimbursement: true,
          splitMode: defaultSplittingOptions.splitMode,
          saveDefaultSplittingOptions: false,
          documents: [],
          notes: '',
        }
      : {
          title: searchParams.get('title') ?? '',
          expenseDate: searchParams.get('date')
            ? new Date(searchParams.get('date') as string)
            : new Date(),
          amount: (searchParams.get('amount') || 0) as unknown as number, // hack,
          category: searchParams.get('categoryId')
            ? Number(searchParams.get('categoryId'))
            : 0, // category with Id 0 is General
          // paid for all, split evenly
          paidFor: defaultSplittingOptions.paidFor,
          paidBy: getSelectedPayer(),
          isReimbursement: false,
          splitMode: defaultSplittingOptions.splitMode,
          saveDefaultSplittingOptions: false,
          documents: searchParams.get('imageUrl')
            ? [
                {
                  id: randomId(),
                  url: searchParams.get('imageUrl') as string,
                  width: Number(searchParams.get('imageWidth')),
                  height: Number(searchParams.get('imageHeight')),
                },
              ]
            : [],
          notes: '',
        },
  })
  const [isCategoryLoading, setCategoryLoading] = useState(false)
  const activeUserId = useActiveUser(group.id)

  const submit = async (values: ExpenseFormValues) => {
    await persistDefaultSplittingOptions(group.id, values)
    return onSubmit(values, activeUserId ?? undefined)
  }

  const [isIncome, setIsIncome] = useState(Number(form.getValues().amount) < 0)
  const [evaluatedAmount, setEvaluatedAmount] = useState('0')
  const sExpense = isIncome ? 'income' : 'expense'
  const sPaid = isIncome ? 'received' : 'paid'

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        <Card>
          <CardHeader>
            <CardTitle>{(isCreate ? 'Create ' : 'Edit ') + sExpense}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="">
                  <FormLabel>{capitalize(sExpense)} title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Monday evening restaurant"
                      className="text-base"
                      {...field}
                      onBlur={async () => {
                        field.onBlur() // avoid skipping other blur event listeners since we overwrite `field`
                        if (runtimeFeatureFlags.enableCategoryExtract) {
                          setCategoryLoading(true)
                          const { categoryId } = await extractCategoryFromTitle(
                            field.value,
                          )
                          form.setValue('category', categoryId)
                          setCategoryLoading(false)
                        }
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter a description for the {sExpense}.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expenseDate"
              render={({ field }) => (
                <FormItem className="sm:order-1">
                  <FormLabel>{capitalize(sExpense)} date</FormLabel>
                  <FormControl>
                    <Input
                      className="date-base"
                      type="date"
                      defaultValue={formatDate(field.value)}
                      onChange={(event) => {
                        return field.onChange(new Date(event.target.value))
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the date the {sExpense} was {sPaid}.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field: { onChange, ...field } }) => (
                <FormItem className="sm:order-3">
                  <FormLabel>Amount</FormLabel>
                  <div className="flex items-baseline gap-2">
                    <span>{group.currency}</span>
                    <FormControl>
                      <Input
                        className="text-base"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        onChange={(event) => {
                          let v = (event.target.value)
                          if (v === '') {
                            setEvaluatedAmount('0')
                          } else {
                            try {
                              const evaluatedValue = Number(mexp.eval(v))
                                .toFixed(2)
                                .replace(/\.?0+$/, '') // replace trailing zeros
                              setEvaluatedAmount(evaluatedValue)
                              const income = Number(evaluatedValue) < 0
                              setIsIncome(income)
                              if (income)
                                form.setValue('isReimbursement', false)
                            } catch {
                              setEvaluatedAmount('Invalid Expression')
                            }
                          }
                          onChange(v)
                        }}
                        onFocus={(e) => {
                          // we're adding a small delay to get around safaris issue with onMouseUp deselecting things again
                          const target = e.currentTarget
                          setTimeout(() => target.select(), 1)
                        }}
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                    <div className="flex flex-row gap-2 items-center justify-between">
                      <div className="text-white/50 pl-5">
                        {' = ' + evaluatedAmount}
                      </div>
                      {!isIncome && (
                      <FormField
                        control={form.control}
                        name="isReimbursement"
                        render={({ field }) => (
                          <FormItem className="flex flex-row gap-2 items-center space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                              <FormLabel>Reimbursement</FormLabel>
                          </FormItem>

                        )}
                      />
                    )}
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem className="order-3 sm:order-2">
                  <FormLabel>Category</FormLabel>
                  <CategorySelector
                    categories={categories}
                    defaultValue={
                      form.watch(field.name) // may be overwritten externally
                    }
                    onValueChange={field.onChange}
                    isLoading={isCategoryLoading}
                  />
                  <FormDescription>
                    Select the {sExpense} category.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paidBy"
              render={({ field }) => (
                <FormItem className="sm:order-5">
                  <FormLabel>{capitalize(sPaid)} by</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={getSelectedPayer(field)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a participant" />
                    </SelectTrigger>
                    <SelectContent>
                      {group.participants.map(({ id, name }) => (
                        <SelectItem key={id} value={id}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select the participant who {sPaid} the {sExpense}.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="sm:order-6">
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea className="text-base" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex justify-between">
              <span>{capitalize(sPaid)} for</span>
              <Button
                variant="link"
                type="button"
                className="-my-2 -mx-4"
                onClick={() => {
                  const paidFor = form.getValues().paidFor
                  const allSelected =
                    paidFor.length === group.participants.length
                  const newPaidFor = allSelected
                    ? []
                    : group.participants.map((p) => ({
                        participant: p.id,
                        shares:
                          paidFor.find((pfor) => pfor.participant === p.id)
                            ?.shares ?? ('1' as unknown as number),
                      }))
                  form.setValue('paidFor', newPaidFor, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }}
              >
                {form.getValues().paidFor.length ===
                group.participants.length ? (
                  <>Select none</>
                ) : (
                  <>Select all</>
                )}
              </Button>
            </CardTitle>
            <CardDescription>
              Select who the {sExpense} was {sPaid} for.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="paidFor"
              render={() => (
                <FormItem className="sm:order-4 row-span-2 space-y-0">
                  {group.participants.map(({ id, name }) => (
                    <FormField
                      key={id}
                      control={form.control}
                      name="paidFor"
                      render={({ field }) => {
                        return (
                          <div
                            data-id={`${id}/${form.getValues().splitMode}/${
                              group.currency
                            }`}
                            className="flex items-center border-t last-of-type:border-b last-of-type:!mb-4 -mx-6 px-6 py-3"
                          >
                            <FormItem className="flex-1 flex flex-row items-start space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.some(
                                    ({ participant }) => participant === id,
                                  )}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([
                                          ...field.value,
                                          {
                                            participant: id,
                                            shares: '1',
                                          },
                                        ])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value.participant !== id,
                                          ),
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal flex-1">
                                {name}
                              </FormLabel>
                            </FormItem>
                            {form.getValues().splitMode !== 'EVENLY' && (
                              <FormField
                                name={`paidFor[${field.value.findIndex(
                                  ({ participant }) => participant === id,
                                )}].shares`}
                                render={() => {
                                  const sharesLabel = (
                                    <span
                                      className={cn('text-sm', {
                                        'text-muted': !field.value?.some(
                                          ({ participant }) =>
                                            participant === id,
                                        ),
                                      })}
                                    >
                                      {match(form.getValues().splitMode)
                                        .with('BY_SHARES', () => <>share(s)</>)
                                        .with('BY_PERCENTAGE', () => <>%</>)
                                        .with('BY_AMOUNT', () => (
                                          <>{group.currency}</>
                                        ))
                                        .otherwise(() => (
                                          <></>
                                        ))}
                                    </span>
                                  )
                                  return (
                                    <div>
                                      <div className="flex gap-1 items-center">
                                        {form.getValues().splitMode ===
                                          'BY_AMOUNT' && sharesLabel}
                                        <FormControl>
                                          <Input
                                            key={String(
                                              !field.value?.some(
                                                ({ participant }) =>
                                                  participant === id,
                                              ),
                                            )}
                                            className="text-base w-[80px] -my-2"
                                            type="text"
                                            disabled={
                                              !field.value?.some(
                                                ({ participant }) =>
                                                  participant === id,
                                              )
                                            }
                                            value={
                                              field.value?.find(
                                                ({ participant }) =>
                                                  participant === id,
                                              )?.shares
                                            }
                                            onChange={(event) =>
                                              field.onChange(
                                                field.value.map((p) =>
                                                  p.participant === id
                                                    ? {
                                                        participant: id,
                                                        shares:
                                                          enforceCurrencyPattern(
                                                            event.target.value,
                                                          ),
                                                      }
                                                    : p,
                                                ),
                                              )
                                            }
                                            inputMode={
                                              form.getValues().splitMode ===
                                              'BY_AMOUNT'
                                                ? 'decimal'
                                                : 'numeric'
                                            }
                                            step={
                                              form.getValues().splitMode ===
                                              'BY_AMOUNT'
                                                ? 0.01
                                                : 1
                                            }
                                          />
                                        </FormControl>
                                        {[
                                          'BY_SHARES',
                                          'BY_PERCENTAGE',
                                        ].includes(
                                          form.getValues().splitMode,
                                        ) && sharesLabel}
                                      </div>
                                      <FormMessage className="float-right" />
                                    </div>
                                  )
                                }}
                              />
                            )}
                          </div>
                        )
                      }}
                    />
                  ))}
                  <FormMessage />
                </FormItem>
              )}
            />

            <Collapsible
              className="mt-5"
              defaultOpen={form.getValues().splitMode !== 'EVENLY'}
            >
              <CollapsibleTrigger asChild>
                <Button variant="link" className="-mx-4">
                  Advanced splitting options…
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid sm:grid-cols-2 gap-6 pt-3">
                  <FormField
                    control={form.control}
                    name="splitMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Split mode</FormLabel>
                        <FormControl>
                          <Select
                            onValueChange={(value) => {
                              form.setValue('splitMode', value as any, {
                                shouldDirty: true,
                                shouldTouch: true,
                                shouldValidate: true,
                              })
                            }}
                            defaultValue={field.value}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="EVENLY">Evenly</SelectItem>
                              <SelectItem value="BY_SHARES">
                                Unevenly – By shares
                              </SelectItem>
                              <SelectItem value="BY_PERCENTAGE">
                                Unevenly – By percentage
                              </SelectItem>
                              <SelectItem value="BY_AMOUNT">
                                Unevenly – By amount
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          Select how to split the {sExpense}.
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="saveDefaultSplittingOptions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row gap-2 items-center space-y-0 pt-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div>
                          <FormLabel>
                            Save as default splitting options
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        {runtimeFeatureFlags.enableExpenseDocuments && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>Attach documents</span>
              </CardTitle>
              <CardDescription>
                See and attach receipts to the {sExpense}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="documents"
                render={({ field }) => (
                  <ExpenseDocumentsInput
                    documents={field.value}
                    updateDocuments={field.onChange}
                  />
                )}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex mt-4 gap-2">
          <SubmitButton
            loadingContent={isCreate ? <>Creating…</> : <>Saving…</>}
          >
            <Save className="w-4 h-4 mr-2" />
            {isCreate ? <>Create</> : <>Save</>}
          </SubmitButton>
          {!isCreate && onDelete && (
            <DeletePopup
              onDelete={() => onDelete(activeUserId ?? undefined)}
            ></DeletePopup>
          )}
          <Button variant="ghost" asChild>
            <Link href={`/groups/${group.id}`}>Cancel</Link>
          </Button>
        </div>
      </form>
    </Form>
  )
}

function formatDate(date?: Date) {
  if (!date || isNaN(date as any)) date = new Date()
  return date.toISOString().substring(0, 10)
}
