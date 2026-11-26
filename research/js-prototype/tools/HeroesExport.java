// Export Ghidra-discovered functions and decoded instruction flow for lifting research.
// @category Heroes
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import com.google.gson.Gson;
import java.io.*;
import java.util.*;

public class HeroesExport extends GhidraScript {
    @Override public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Pass an output JSONL path under local/analysis");
        File output = new File(args[0]);
        if (!output.createNewFile()) throw new IOException("Output already exists");
        Gson gson = new Gson();
        try (PrintWriter writer = new PrintWriter(new OutputStreamWriter(new FileOutputStream(output), java.nio.charset.StandardCharsets.UTF_8))) {
            FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
            while (functions.hasNext()) {
                monitor.checkCancelled();
                Function function = functions.next();
                Map<String, Object> record = new LinkedHashMap<>();
                record.put("name", function.getName());
                record.put("entry", function.getEntryPoint().toString());
                record.put("bodyBytes", function.getBody().getNumAddresses());
                List<Object> decoded = new ArrayList<>();
                InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
                while (instructions.hasNext()) {
                    Instruction instruction = instructions.next();
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("address", instruction.getAddress().toString());
                    item.put("size", instruction.getLength());
                    item.put("assembly", instruction.toString());
                    item.put("flowType", instruction.getFlowType().toString());
                    item.put("fallthrough", instruction.getFallThrough() == null ? null : instruction.getFallThrough().toString());
                    List<String> targets = new ArrayList<>();
                    for (var target : instruction.getFlows()) targets.add(target.toString());
                    item.put("targets", targets);
                    List<String> pcode = new ArrayList<>();
                    for (var operation : instruction.getPcode()) pcode.add(operation.toString());
                    item.put("pcode", pcode);
                    decoded.add(item);
                }
                record.put("instructions", decoded);
                writer.println(gson.toJson(record));
            }
            if (writer.checkError()) throw new IOException("Failed writing analysis export");
        }
        println("Exported discovered functions. This is analysis data, not recompilable source.");
    }
}
