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
import { countries } from "@/lib/countries"

interface CountrySelectorProps {
    value: string
    onChange: (value: string) => void
}

export function CountrySelector({ value, onChange }: CountrySelectorProps) {
    const [open, setOpen] = React.useState(false)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal rounded-sm hover:bg-[#F3F3F3]"
                >
                    {value ? value : "Select country"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 rounded-sm" align="start" side="bottom" avoidCollisions={false} sideOffset={4}>
                <Command>
                    <CommandInput placeholder="Search country..." />
                    <CommandList className="max-h-[200px]">
                        <CommandEmpty>No country found.</CommandEmpty>
                        <CommandGroup>
                            {countries.map((country) => (
                                <CommandItem
                                    key={country}
                                    value={country}
                                    onSelect={(currentValue) => {
                                        onChange(currentValue === value ? "" : currentValue)
                                        setOpen(false)
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === country ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    {country}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
