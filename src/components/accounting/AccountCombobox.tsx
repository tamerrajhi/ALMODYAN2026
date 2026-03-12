import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface HierarchicalAccount {
  id: string;
  account_code: string;
  account_name: string;
  parent_id: string | null;
  level: number;
  isLeaf: boolean;
  fullPath: string;
}

interface AccountComboboxProps {
  accounts: HierarchicalAccount[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  showOnlyLeaf?: boolean;
}

export function AccountCombobox({
  accounts,
  value,
  onValueChange,
  placeholder = "اختر الحساب",
  showOnlyLeaf = false,
}: AccountComboboxProps) {
  const [open, setOpen] = React.useState(false);

  // Filter to show only leaf accounts if showOnlyLeaf is true
  const displayAccounts = showOnlyLeaf 
    ? accounts.filter(acc => acc.isLeaf) 
    : accounts;

  const selectedAccount = displayAccounts.find((acc) => acc.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selectedAccount ? (
            <span className="truncate">
              {selectedAccount.account_code} - {selectedAccount.account_name}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 z-50 bg-popover" align="start">
        <Command
          filter={(value, search) => {
            const account = displayAccounts.find((acc) => acc.id === value);
            if (!account) return 0;
            const searchLower = search.toLowerCase();
            if (
              account.account_code.toLowerCase().includes(searchLower) ||
              account.account_name.toLowerCase().includes(searchLower) ||
              account.fullPath.toLowerCase().includes(searchLower)
            ) {
              return 1;
            }
            return 0;
          }}
        >
          <CommandInput placeholder="ابحث عن حساب..." className="text-right" />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup>
              {displayAccounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.id}
                  onSelect={(currentValue) => {
                    if (account.isLeaf) {
                      onValueChange(currentValue === value ? "" : currentValue);
                      setOpen(false);
                    }
                  }}
                  disabled={!account.isLeaf}
                  className={cn(
                    "flex items-center gap-2",
                    !account.isLeaf && "opacity-60 font-semibold cursor-not-allowed"
                  )}
                >
                  <div
                    style={{ paddingRight: `${account.level * 16}px` }}
                    className="flex items-center gap-2 flex-1"
                  >
                    {!account.isLeaf ? (
                      <span className="text-muted-foreground text-xs">📁</span>
                    ) : (
                      <span className="text-primary text-xs">◉</span>
                    )}
                    <span className="truncate">
                      {account.account_code} - {account.account_name}
                    </span>
                  </div>
                  {account.isLeaf && (
                    <Check
                      className={cn(
                        "h-4 w-4",
                        value === account.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
