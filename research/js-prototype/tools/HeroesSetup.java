// Ghidra pre-analysis script. Run against the prepared flat image, not the XBE.
// @category Heroes
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonElement;
import java.io.FileReader;

public class HeroesSetup extends GhidraScript {
    private Address address(long value) { return currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(value); }
    @Override public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Pass local/analysis/layout.json");
        JsonObject layout;
        try (FileReader reader = new FileReader(args[0])) {
            layout = JsonParser.parseReader(reader).getAsJsonObject();
        }
        long base = layout.get("baseAddress").getAsLong();
        long size = layout.get("imageSize").getAsLong();
        Memory memory = currentProgram.getMemory();
        if (memory.getBlock(address(base)) == null || memory.getBlock(address(base + size - 1)) == null)
            throw new IllegalArgumentException("Import the prepared memory.bin at the specified base first");
        // Split at every section boundary so padding and zero-filled data do not
        // inherit executable permissions from the raw binary loader.
        java.util.TreeSet<Long> boundaries = new java.util.TreeSet<>();
        boundaries.add(base + layout.get("headersSize").getAsLong());
        for (JsonElement element : layout.getAsJsonArray("sections")) {
            JsonObject section = element.getAsJsonObject();
            long start = section.get("address").getAsLong();
            boundaries.add(start);
            boundaries.add(start + section.get("virtualSize").getAsLong());
        }
        for (long boundary : boundaries) {
            if (boundary <= base || boundary >= base + size) continue;
            MemoryBlock block = memory.getBlock(address(boundary));
            if (block != null && !block.getStart().equals(address(boundary))) memory.split(block, address(boundary));
        }
        for (MemoryBlock block : memory.getBlocks()) {
            block.setRead(true); block.setWrite(false); block.setExecute(false);
        }
        int index = 0;
        for (JsonElement element : layout.getAsJsonArray("sections")) {
            JsonObject section = element.getAsJsonObject();
            MemoryBlock block = memory.getBlock(address(section.get("address").getAsLong()));
            block.setName("s" + index++ + "_" + section.get("name").getAsString());
            block.setWrite(section.get("writable").getAsBoolean());
            // Several data sections carry the XBE executable flag. Do not seed
            // functions by scanning all executable bytes; retain the actual flag.
            block.setExecute(section.get("executable").getAsBoolean());
        }
        Address entry = address(layout.get("entryPoint").getAsLong());
        createLabel(entry, "heroes_entry", true, SourceType.USER_DEFINED);
        addEntryPoint(entry);
        disassemble(entry);
        if (getFunctionAt(entry) == null) createFunction(entry, "heroes_entry");
        for (JsonElement element : layout.getAsJsonArray("kernelImports")) {
            JsonObject thunk = element.getAsJsonObject();
            createLabel(address(thunk.get("slot").getAsLong()), "xboxkrnl_ordinal_" + thunk.get("ordinal").getAsInt(), true, SourceType.USER_DEFINED);
        }
        println("Mapped sections, entry point and kernel slots. Run auto-analysis next.");
    }
}
