// Synthetic arithmetic only: no game bytes or game image are accepted here.
// Executes original test snippets on the host CPU to check result/flags semantics.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ArithmeticOracle {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr VirtualAlloc(IntPtr address, UIntPtr size, uint type, uint protection);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool VirtualProtect(IntPtr address, UIntPtr size, uint protection, out uint oldProtection);
    [DllImport("kernel32.dll")] static extern bool VirtualFree(IntPtr address, UIntPtr size, uint type);
    [DllImport("kernel32.dll")] static extern bool FlushInstructionCache(IntPtr process, IntPtr address, UIntPtr size);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate void Operation(uint a, uint b, IntPtr output);

    static int Main() {
        if (IntPtr.Size != 8) throw new Exception("Requires x64 process");
        var encodings = new Dictionary<string, byte[]> {
            {"add", new byte[]{0x89,0xc8,0x01,0xd0}},
            {"sub", new byte[]{0x89,0xc8,0x29,0xd0}},
            {"and", new byte[]{0x89,0xc8,0x21,0xd0}},
            {"or",  new byte[]{0x89,0xc8,0x09,0xd0}},
            {"xor", new byte[]{0x89,0xc8,0x31,0xd0}},
            {"shr", new byte[]{0x89,0xc8,0x89,0xd1,0xd3,0xe8}}
        };
        var byteOps = new Dictionary<string,byte>{{"add",0x00},{"sub",0x28},{"and",0x20},{"or",0x08},{"xor",0x30}};
        var wordOps = new Dictionary<string,byte>{{"add",0x01},{"sub",0x29},{"and",0x21},{"or",0x09},{"xor",0x31}};
        foreach(var pair in byteOps) encodings.Add(pair.Key+"8",new byte[]{0x89,0xc8,pair.Value,0xd0});
        foreach(var pair in wordOps) encodings.Add(pair.Key+"16",new byte[]{0x89,0xc8,0x66,pair.Value,0xd0});
        encodings.Add("adc",new byte[]{0xf9,0x89,0xc8,0x11,0xd0});
        encodings.Add("sbb",new byte[]{0xf9,0x89,0xc8,0x19,0xd0});
        encodings.Add("sar",new byte[]{0x89,0xc8,0x89,0xd1,0xd3,0xf8});
        encodings.Add("shl",new byte[]{0x89,0xc8,0x89,0xd1,0xd3,0xe0});
        // Stack scratch holds float input, requested CW, and saved CW. All bytes
        // are original synthetic tests, with no addresses into the game image.
        encodings.Add("x87round",new byte[]{
            0x48,0x83,0xec,0x10,0x89,0x0c,0x24,0x66,0x89,0x54,0x24,0x04,
            0xd9,0x7c,0x24,0x06,0xdb,0xe2,0xd9,0x6c,0x24,0x04,0xd9,0x04,0x24,
            0x41,0xdb,0x18,0xdf,0xe0,0x0f,0xb7,0xc0,0x41,0x89,0x40,0x08,
            0xdb,0xe2,0xd9,0x6c,0x24,0x06,0x48,0x83,0xc4,0x10,0xc3});
        // mov [r8],eax; pushfq; pop rax; mov [r8+8],rax; ret
        byte[] capture = {0x41,0x89,0x00,0x9c,0x58,0x49,0x89,0x40,0x08,0xc3};
        var pages = new List<IntPtr>();
        var operations = new Dictionary<string, Operation>();
        IntPtr output = Marshal.AllocHGlobal(16);
        try {
            foreach (var pair in encodings) {
                byte[] code = new byte[pair.Value.Length + (pair.Key=="x87round"?0:capture.Length)];
                Array.Copy(pair.Value, code, pair.Value.Length);
                if(pair.Key!="x87round")Array.Copy(capture, 0, code, pair.Value.Length, capture.Length);
                IntPtr page = VirtualAlloc(IntPtr.Zero, (UIntPtr)4096, 0x3000, 0x04);
                if (page == IntPtr.Zero) throw new Exception("VirtualAlloc failed");
                pages.Add(page);
                Marshal.Copy(code, 0, page, code.Length);
                uint oldProtection;
                if (!VirtualProtect(page, (UIntPtr)4096, 0x20, out oldProtection)) throw new Exception("VirtualProtect failed");
                if (!FlushInstructionCache(GetCurrentProcess(), page, (UIntPtr)code.Length)) throw new Exception("FlushInstructionCache failed");
                operations.Add(pair.Key, (Operation)Marshal.GetDelegateForFunctionPointer(page, typeof(Operation)));
            }
            string line;
            while ((line = Console.ReadLine()) != null) {
                string[] fields = line.Split(' ');
                Marshal.WriteInt64(output,8,0);
                operations[fields[0]](UInt32.Parse(fields[1]), UInt32.Parse(fields[2]), output);
                Console.WriteLine(unchecked((uint)Marshal.ReadInt32(output)) + " " + unchecked((ulong)Marshal.ReadInt64(output, 8)));
            }
        } finally {
            Marshal.FreeHGlobal(output);
            foreach (IntPtr page in pages) VirtualFree(page, UIntPtr.Zero, 0x8000);
        }
        return 0;
    }
}
