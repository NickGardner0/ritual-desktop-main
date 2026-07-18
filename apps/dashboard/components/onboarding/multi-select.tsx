"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface MultiSelectProps {
    options: string[]
    value: string[]
    onChange: (value: string[]) => void
    placeholder?: string
    searchPlaceholder?: string
    side?: "top" | "bottom"
}

export function MultiSelect({
    options,
    value,
    onChange,
    placeholder = "Select items",
    searchPlaceholder = "Search items...",
    side = "bottom",
}: MultiSelectProps) {
    const [open, setOpen] = React.useState(false)

    const handleSelect = (item: string) => {
        if (value.includes(item)) {
            onChange(value.filter((i) => i !== item))
        } else {
            onChange([...value, item])
        }
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal rounded-sm hover:bg-[#F3F3F3]"
                >
                    {value.length > 0 ? `${value.length} selected` : placeholder}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" side={side} avoidCollisions={false} sideOffset={4}>
                <Command>
                    <CommandInput placeholder={searchPlaceholder} />
                    <CommandList className="max-h-[150px]">
                        <CommandEmpty>No item found.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option}
                                    value={option}
                                    onSelect={() => handleSelect(option)}
                                >
                                    <div
                                        className={cn(
                                            "mr-2 h-4 w-4 border border-gray-300 rounded-sm flex items-center justify-center",
                                            value.includes(option) && "bg-black border-black"
                                        )}
                                    >
                                        {value.includes(option) && (
                                            <Check className="h-3 w-3 text-white" />
                                        )}
                                    </div>
                                    {option}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
