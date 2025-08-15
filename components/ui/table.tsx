"use client"

import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ChevronDown, Settings2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Basic Table UI Components (for other parts of the app)
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto rounded-none">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm rounded-none", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

// Your v0 Data Table Component
export type Habit = {
  id: string
  date: string
  time: string
  name: string
  category: string
  trackerType: string
  unit: string
  value: string
  streak: number
}

const data: Habit[] = [
  {
    id: "1",
    date: "Jul 8",
    time: "9:30 AM",
    name: "Deep Work",
    category: "Productivity",
    trackerType: "Duration",
    unit: "hours",
    value: "2.5",
    streak: 7,
  },
  {
    id: "2",
    date: "Jul 7",
    time: "7:15 PM",
    name: "Reading",
    category: "Learning",
    trackerType: "Duration",
    unit: "minutes",
    value: "30",
    streak: 12,
  },
  {
    id: "3",
    date: "Jul 2",
    time: "8:00 AM",
    name: "Hydration",
    category: "Health",
    trackerType: "Count",
    unit: "glasses",
    value: "8",
    streak: 3,
  },
  {
    id: "4",
    date: "Jul 2",
    time: "6:45 AM",
    name: "Exercise",
    category: "Health",
    trackerType: "Duration",
    unit: "minutes",
    value: "45",
    streak: 5,
  },
  {
    id: "5",
    date: "Jul 2",
    time: "10:00 PM",
    name: "Meditation",
    category: "Wellness",
    trackerType: "Duration",
    unit: "minutes",
    value: "15",
    streak: 14,
  },
  {
    id: "6",
    date: "Jul 1",
    time: "11:30 PM",
    name: "Journal Writing",
    category: "Personal",
    trackerType: "Boolean",
    unit: "completed",
    value: "Yes",
    streak: 21,
  },
  {
    id: "7",
    date: "Jun 30",
    time: "2:15 PM",
    name: "Language Learning",
    category: "Learning",
    trackerType: "Duration",
    unit: "minutes",
    value: "25",
    streak: 8,
  },
  {
    id: "8",
    date: "Jun 29",
    time: "10:45 PM",
    name: "Sleep Quality",
    category: "Health",
    trackerType: "Rating",
    unit: "score",
    value: "8/10",
    streak: 4,
  },
]

export const columns: ColumnDef<Habit>[] = [
  {
    accessorKey: "date",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => {
            console.log("Date column clicked, current sort:", column.getIsSorted());
            column.toggleSorting(column.getIsSorted() === "asc");
          }}
          className="cursor-pointer flex items-center hover:bg-red-100 p-2 bg-blue-50 border border-red-500"
          style={{ minHeight: '40px', width: '100%' }}
        >
          Date
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div className="font-medium">{row.getValue("date")}</div>,
  },
  {
    accessorKey: "time",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Time
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div className="font-medium">{row.getValue("time")}</div>,
  },
  {
    accessorKey: "name",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Name
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div>{row.getValue("name")}</div>,
  },
  {
    accessorKey: "category",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Category
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => {
      const category = row.getValue("category") as string
      return (
        <Badge variant="secondary" className="text-xs rounded-none">
          {category}
        </Badge>
      )
    },
  },
  {
    accessorKey: "trackerType",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Tracker Type
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div>{row.getValue("trackerType")}</div>,
  },
  {
    accessorKey: "value",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Value
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div className="font-medium">{row.getValue("value")}</div>,
  },
  {
    accessorKey: "unit",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Unit
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div>{row.getValue("unit")}</div>,
  },
  {
    accessorKey: "streak",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <div
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="cursor-pointer flex items-center hover:bg-gray-50 -ml-4 p-1"
        >
          Streak
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </div>
      )
    },
    cell: ({ row }) => <div className="font-medium">{row.getValue("streak")} days</div>,
  },
]

export default function DataTableDemo() {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  console.log("Current sorting state:", sorting);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  })

  return (
    <div className="w-full bg-white">
      <div className="flex items-center py-4 gap-4">
        <Input
          placeholder="Search habits..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(event) => table.getColumn("name")?.setFilterValue(event.target.value)}
          className="max-w-sm rounded-none focus:ring-0 focus:ring-offset-0 focus:border-border focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto bg-transparent rounded-none">
              <Settings2 className="mr-2 h-4 w-4" />
              Columns <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <div
                    key={column.id}
                    className="flex items-center space-x-3 px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground capitalize"
                    onClick={() => column.toggleVisibility(!column.getIsVisible())}
                  >
                    <div
                      className={`w-4 h-4 border border-gray-300 rounded-sm flex items-center justify-center ${column.getIsVisible() ? "bg-black" : "bg-white"}`}
                    >
                      {column.getIsVisible() && (
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                    <span>{column.id}</span>
                  </div>
                )
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="border border-gray-300 bg-white rounded-none">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-gray-300">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className="text-muted-foreground font-medium border-r border-gray-300 last:border-r-0"
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="border-b border-gray-300 hover:bg-muted/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3 border-r border-gray-300 last:border-r-0">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// Export the basic UI components for other parts of the app
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

