/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useMemo, useState } from 'react';
import { Control, Controller, FieldError } from 'react-hook-form';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import countryList from 'react-select-country-list';
import { useLocale, useTranslations } from 'next-intl';

type CountrySelectProps = {
    name: string;
    label: string;
    control: Control<any>;
    error?: FieldError;
    required?: boolean;
};

// Localized country names via the built-in Intl API; the submitted `value`
// stays the ISO code the library provides.
const useLocalizedCountries = (locale: string) =>
    useMemo(() => {
        const base = countryList().getData();
        let displayNames: Intl.DisplayNames | undefined;
        try {
            displayNames = new Intl.DisplayNames([locale], { type: 'region' });
        } catch {
            displayNames = undefined;
        }
        return base
            .map((country) => ({
                value: country.value,
                label: displayNames?.of(country.value) ?? country.label,
            }))
            .sort((a, b) => a.label.localeCompare(b.label, locale));
    }, [locale]);

const CountrySelect = ({
                           value,
                           onChange,
                       }: {
    value: string;
    onChange: (value: string) => void;
}) => {
    const [open, setOpen] = useState(false);
    const locale = useLocale();
    const t = useTranslations('country');

    const countries = useLocalizedCountries(locale);

    // Helper function to get flag emoji
    const getFlagEmoji = (countryCode: string) => {
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map((char) => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant='outline'
                    role='combobox'
                    aria-expanded={open}
                    className='country-select-trigger'
                >
                    {value ? (
                        <span className='flex items-center gap-2'>
              <span>{getFlagEmoji(value)}</span>
              <span>{countries.find((c) => c.value === value)?.label}</span>
            </span>
                    ) : (
                        t('placeholder')
                    )}
                    <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className='w-full p-0 bg-gray-800 border-gray-600'
                align='start'
            >
                <Command className='bg-gray-800 border-gray-600'>
                    <CommandInput
                        placeholder={t('search')}
                        className='country-select-input'
                    />
                    <CommandEmpty className='country-select-empty'>
                        {t('empty')}
                    </CommandEmpty>
                    <CommandList className='max-h-60 bg-gray-800 scrollbar-hide-default'>
                        <CommandGroup className='bg-gray-800'>
                            {countries.map((country) => (
                                <CommandItem
                                    key={country.value}
                                    value={`${country.label} ${country.value}`}
                                    onSelect={() => {
                                        onChange(country.value);
                                        setOpen(false);
                                    }}
                                    className='country-select-item'
                                >
                                    <Check
                                        className={cn(
                                            'mr-2 h-4 w-4 text-teal-500',
                                            value === country.value ? 'opacity-100' : 'opacity-0'
                                        )}
                                    />
                                    <span className='flex items-center gap-2'>
                    <span>{getFlagEmoji(country.value)}</span>
                    <span>{country.label}</span>
                  </span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export const CountrySelectField = ({
                                       name,
                                       label,
                                       control,
                                       error,
                                       required = false,
                                   }: CountrySelectProps) => {
    const t = useTranslations('country');

    return (
        <div className='space-y-2'>
            <Label htmlFor={name} className='form-label'>
                {label}
            </Label>
            <Controller
                name={name}
                control={control}
                rules={{
                    required: required ? t('required') : false,
                }}
                render={({ field }) => (
                    <CountrySelect value={field.value} onChange={field.onChange} />
                )}
            />
            {error && <p className='text-sm text-red-500'>{error.message}</p>}
            <p className='text-xs text-gray-500'>
                {t('helper')}
            </p>
        </div>
    );
};
